import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { emptyStats } from '../database/types';
import { AuthConfig, requestAccount, sessionResponse, verifyAccountToken, authDisabled, profileAuthConfig, accountIsCurrent, authFailureStatus } from '../auth/session';
import { accountsResponse } from './accounts';
import { contentReportResponse } from './content-reports';
import { ContentReports } from '../security/reports';
import { ArchiveReservations } from '../storage/reservations';
import type { Account } from '../auth/session';
import { QuotaConfig, playerCount } from '../ai/quota';
import { PlayerQuotaBudget } from '../ai/player-quota';
import { HfConnections, HfRequiredError, requirePlayerHf, type HfConfig } from '../auth/huggingface';
import { nodeHfStorage } from '../auth/node-hf-storage';
import { huggingFaceResponse } from './huggingface';
import { privatePath } from './indexing';
import { securityHeaders } from '../security/headers';
import { operationFailure } from '../security/diagnostics';
import { ROBOTS_TEXT, SITEMAP_XML } from './seo';
import { qualityConfig } from '../ai/providers';
import { preparedImageSize } from '../ai/images';
import { normalizeImage } from '../security/images';
import { generationSafetyReady, moderateInput, validatePrompt } from '../security/moderation';
import { archiveRecovery } from '../ai/recovery';
import { approvedProvider } from '../ai/provider-trust';
import { gameOptions } from '../game/options';
import { archiveCapacity, isArchiveGame, prepareArchive, playArchiveVideo } from '../game/archive-play';
import { closePhase, syncPhase } from '../game/phases';
import { writeSharedImage, readSharedImage, deleteSharedImage, sharedImageResponse, type ImageStorage } from '../game/images';
import { ArchiveConfig, archiveVideo, serveVideo, archiveEnabled, deleteArchivedVideo, type ArchiveArtifact } from '../storage/archive';
import { archiveStatus } from './archive';
import { historyResponse, historyListing, restoreHistoryResponse, deleteStoredHistory, historyVideo, purgeDeletedVideos, HistoryError, historyViewer, authorizeHistory, authorizeRestore } from './statistics';
import { Server, Socket } from 'socket.io';
import { generateAiVideo, resumeAiVideo, AiPendingError, AiExpiredError, AI_RETRY_MS, AI_JOB_MAX_AGE_MS, validateImage, buildVideoPrompt, DEFAULT_PROVIDER_CHAIN } from '../ai/generation';
import { takeRateLimit, rateKey, httpRateRule, httpRateScope, MESSAGE_RATE, MESSAGE_BYTES, expensiveMessageRule, payloadBytes, RATE_MESSAGE, type RateBuckets } from '../security/rate-limit';
import { logAiEvent } from '../ai/telemetry';
import {
    Room, Player, activeCreator, roomSnapshot, finishVoting, finalStandings,
    removePlayer, sanitizeUsername, sanitizeRoomId, sanitizeSessionId, roundLimit, maxRounds,
    DISCONNECT_GRACE_MS, startRounds, advanceTurn, remainingVideos, remainingVideosFor, extendRound, recordVote, judgeGuesses, roomAccountIds
} from '../game/rules';
import { ensureDatabaseSchema, getProfiles, getDatabase, getStats, isDatabaseEnabled, markRoomStarted, markRoomFinished, saveRoom, saveScores, saveRound, roomExists, reopenRoom } from '../database/node';
import { roundInput } from '../game/persistence';
import { participants, participantForConnection, isSpectator, resetReady, startProblem, checkJoin, prepareRematch } from '../game/participants';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 12 * 1024 * 1024 });
const PUBLIC_ROOT = path.join(__dirname, '../../public');
const PORT = Number(process.env.PORT) || 3000;
const AI_PROVIDER = process.env.AI_PROVIDER || (process.env.USE_MOCK_AI === 'true' ? 'mock' : 'wan22');
const AI_PROVIDER_CHAIN = process.env.AI_PROVIDER_CHAIN || DEFAULT_PROVIDER_CHAIN;
const AI_ROUND_LIMIT = roundLimit(process.env.AI_ROUND_LIMIT);
const rooms = new Map<string, Room>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();
const persistence = new Map<string, Promise<void>>();
const pendingStarts = new Set<string>();
const httpBuckets: RateBuckets = {};
const messageBuckets: RateBuckets = {};
const budgetData = new Map<string, unknown>();
const config: AuthConfig & HfConfig & QuotaConfig & ArchiveConfig = profileAuthConfig({ ...process.env, AI_PROVIDER, AI_PROVIDER_CHAIN, AI_IMAGE_PROFILE: process.env.AI_IMAGE_PROFILE || 'bounded' }, getProfiles());
const hf = new HfConnections(nodeHfStorage(process.env.HF_LOCAL_STORAGE_DIR || path.join(process.cwd(), '.local/hf')), config);
const reports = new ContentReports(nodeHfStorage(process.env.MODERATION_LOCAL_STORAGE_DIR || path.join(process.cwd(), '.local/moderation')));
const archiveReservations = new ArchiveReservations(nodeHfStorage(process.env.ARCHIVE_RESERVATIONS_LOCAL_STORAGE_DIR || path.join(process.cwd(), '.local/archive-reservations')));
async function canReadVideo(url: string, account: Account) {
    return account.id === config.ADMIN_ACCOUNT_ID || [...rooms.values()].some(room => room.currentVideoUrl === url && participants(room).some(p => p.accountId === account.id))
        || Boolean(await getDatabase()?.canReadVideo(url, account.id));
}
async function playableArchive(room: Room) {
    const clips = await getDatabase()?.playableArchive(authDisabled(config) ? undefined : roomAccountIds(room)) || [];
    const allowed = new Set(await reports.allowed(clips.map(clip => clip.videoUrl)));
    return clips.filter(clip => allowed.has(clip.videoUrl));
}
config.verifyHfIdentity = (connection, accountId) => hf.identityMatches(connection, accountId);
const imageData = new Map<string, unknown>();
const imageStorage: ImageStorage = { get: async <T>(key: string) => imageData.get(key) as T | undefined,
    put: async (key, value) => { imageData.set(key, value); }, delete: async key => { imageData.delete(key); } };
const budget = new PlayerQuotaBudget({ get: async <T>(key: string) => structuredClone(budgetData.get(key)) as T | undefined, put: async (key, value) => { budgetData.set(key, structuredClone(value)); } }, config, hf);
let budgetWork: Promise<unknown> = Promise.resolve();
let archiveWork: Promise<unknown> = Promise.resolve();
let videoCleanupTimer: NodeJS.Timeout | undefined;
let videoCleanupAt = Infinity;
function scheduleVideoCleanup(time: number) {
    if (videoCleanupAt <= time) return;
    clearTimeout(videoCleanupTimer); videoCleanupAt = time;
    videoCleanupTimer = setTimeout(() => {
        videoCleanupAt = Infinity;
        const cleanup = archiveWork.then(async () => {
            const database = getDatabase();
            await purgeDeletedVideos(database, url => deleteArchivedVideo(url, config));
            const next = await database?.nextVideoDeletion();
            if (next !== undefined) scheduleVideoCleanup(Math.max(Date.now() + 100, next));
        });
        archiveWork = cleanup.catch(() => { scheduleVideoCleanup(Date.now() + 30_000); });
    }, Math.max(0, time - Date.now()));
    videoCleanupTimer.unref();
}
if (isDatabaseEnabled()) scheduleVideoCleanup(Date.now() + 1000);
function withBudget<T>(action: () => Promise<T>): Promise<T> { const result = budgetWork.then(action); budgetWork = result.catch(() => {}); return result; }
const hfCleanupClock = setInterval(() => { void hf.cleanup().catch(() => {}); }, 60_000);
hfCleanupClock.unref();
function archive(url: string, code?: string, artifact?: ArchiveArtifact) {
    const result = archiveWork.then(async () => {
        const database = getDatabase();
        const active = [...rooms.values()].map(r => r.currentVideoUrl).filter(Boolean);
        const stored = await archiveVideo(url, config, [...await database?.protectedVideoUrls() || [], ...active, ...await archiveReservations.activeUrls()], database ? urls => database.reconcileArchive(urls) : undefined, code, artifact);
        if (code && stored.startsWith('/api/videos/')) await archiveReservations.protect(code, stored);
        return stored;
    });
    archiveWork = result.catch(() => {}); return result;
}
app.use(async (req, res, next) => {
    for (const [name, value] of Object.entries(securityHeaders(`${req.protocol}://${req.get('host')}`))) res.setHeader(name, value);
    if (privatePath(req.path)) { res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet'); res.setHeader('Cache-Control', 'no-store'); }
    const rule = httpRateRule(req.path, req.method);
    if (rule) {
        const key = await rateKey(req.socket.remoteAddress || 'local', httpRateScope(req.path, req.method), config.AUTH_COOKIE_SECRET);
        const retryAfter = takeRateLimit(httpBuckets, key, rule);
        if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); res.setHeader('Cache-Control', 'no-store'); res.status(429).json({ error: RATE_MESSAGE }); return; }
    }
    next();
});
function webRequest(req: express.Request) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    return new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, { method: req.method, headers, body: typeof req.body === 'string' && req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined });
}
async function webResponse(response: Response, res: express.Response) {
    res.status(response.status);
    for (const [key, value] of response.headers) if (key !== 'set-cookie') res.setHeader(key, value);
    const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
    if (response.body) await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), res);
    else res.end();
}
app.all(['/.well-known/oauth-cimd', '/api/hf', '/api/hf/:action'], async (req, res) => webResponse(await huggingFaceResponse(webRequest(req), config, async (endpoint, data) => {
    if (endpoint === '/hf/start') return hf.start(data.account as any, data.origin as string);
    if (endpoint === '/hf/device/start') return hf.startDevice(data.account as any, data.origin as string, data.nonce as string | undefined);
    if (endpoint === '/hf/device/status') return hf.deviceStatus(data.nonce as string | undefined, data.accountId as string, data.origin as string);
    if (endpoint === '/hf/device/poll') return hf.pollDevice(data.nonce as string | undefined, data.account as any, data.origin as string);
    if (endpoint === '/hf/device/cancel') { await hf.cancelDevice(data.nonce as string | undefined, data.accountId as string, data.origin as string); return { ok: true }; }
    if (endpoint === '/hf/finish') return hf.finish(data.state, data.code, data.nonce, data.origin as string);
    if (endpoint === '/hf/status') return hf.status(data.connection as string | undefined, data.accountId as string);
    if (endpoint === '/hf/disconnect') { await hf.disconnect(data.connection as string | undefined, data.accountId as string); return { ok: true }; }
    throw new Error('Unbekannte HF-Anfrage.');
}), res));
app.use('/api/auth', (_req, res) => res.sendStatus(404));
app.all('/api/session', express.text({ type: '*/*', limit: '2kb' }), async (req, res) => webResponse(await sessionResponse(webRequest(req), config, getProfiles()), res));
app.use(['/api/moderation', '/api/admin/moderation'], express.text({ type: '*/*', limit: '1kb' }), async (req, res) => webResponse(await contentReportResponse(webRequest(req), config, reports, canReadVideo), res));
app.use('/api/admin', express.text({ type: '*/*', limit: '2kb' }), async (req, res) => webResponse(await accountsResponse(webRequest(req), config, getProfiles()), res));
app.use('/api/videos', async (req, res) => {
    let account;
    try { account = await requestAccount(webRequest(req), config); } catch (error) { res.sendStatus(authFailureStatus(error)); return; }
    const request = webRequest(req);
    if (!authDisabled(config) && account?.id !== config.ADMIN_ACCOUNT_ID) {
        const url = new URL(request.url).pathname;
        if (!account || !await canReadVideo(url, account)) { res.sendStatus(403); return; }
    }
    try { if (await reports.blocked(new URL(request.url).pathname)) { res.sendStatus(410); return; } }
    catch { res.sendStatus(503); return; }
    await webResponse(await serveVideo(request, new URL(request.url).pathname.slice('/api/videos/'.length), config), res);
});
app.get('/api/rooms/:code/image', async (req, res) => {
    const request = webRequest(req);
    try {
        const account = await requestAccount(request, config), room = rooms.get(sanitizeRoomId(req.params.code));
        if (!room || (!authDisabled(config) && !participants(room).some(player => player.accountId === account?.id))) { res.sendStatus(403); return; }
        await webResponse(await sharedImageResponse(request, imageStorage, room.sharedImage), res);
    } catch (error) { res.sendStatus(authFailureStatus(error)); }
});

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'index.html')));
app.get(['/index.html', '/index'], (_req, res) => res.redirect(301, '/'));
app.get('/robots.txt', (_req, res) => res.set({ 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600', 'X-Content-Type-Options': 'nosniff' }).send(ROBOTS_TEXT));
app.get('/sitemap.xml', (_req, res) => res.set({ 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600', 'X-Content-Type-Options': 'nosniff' }).send(SITEMAP_XML));
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'favicon.ico')));
app.get('/apple-touch-icon.png', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'apple-touch-icon.png')));
app.get('/apple-touch-icon-precomposed.png', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'apple-touch-icon.png')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'style.css')));
app.get('/script.js', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'script.js')));
app.get('/startup.js', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'startup.js')));
app.use('/assets', express.static(path.join(PUBLIC_ROOT, 'assets')));
app.get('/api/config', async (req, res) => {
    let players: number;
    try { players = playerCount(req.query.players ?? 1); } catch { res.status(400).json({ error: 'Ungültige Spielerzahl.' }); return; }
    const account = await requestAccount(webRequest(req), config).catch(() => undefined);
    const signedIn = authDisabled(config) || Boolean(account);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        ...(signedIn ? await budget.displayCapacity(players, 'auto', account?.hfConnectionId && players === 1 ? [{ id: account.id, accountId: account.id, hfConnectionId: account.hfConnectionId }] : undefined) : { aiRoundLimit: 0, quotaMode: 'unavailable' }), authEnabled: !authDisabled(config),
        aiProvider: AI_PROVIDER === 'mock' ? 'mock' : AI_PROVIDER_CHAIN,
        mockAi: AI_PROVIDER === 'mock', hfRequired: AI_PROVIDER !== 'mock', videoDuration: Math.max(5, Number(process.env.LTX_DURATION) || 5)
    });
});
app.get('/api/stats', async (req, res) => {
    let account;
    try { account = await requestAccount(webRequest(req), config); } catch (error) { res.sendStatus(authFailureStatus(error)); return; }
    try {
        const status = archiveWork.then(() => archiveStatus(config, getDatabase()));
        archiveWork = status.catch(() => {});
        const archive = await status.catch(() => null);
        res.json({ databaseEnabled: isDatabaseEnabled(), ...(await getDatabase()?.getStats(typeof req.query.player === 'string' ? req.query.player.slice(0, 100) : undefined, historyViewer(account, config)) ?? emptyStats()),
            videoStorageMode: archiveEnabled(config) ? 'archive' : 'url', archive });
    }
    catch (error) {
        operationFailure('statistics', error);
        res.status(503).json({ error: 'Statistiken konnten nicht geladen werden.' });
    }
});

app.all(['/api/stats/videos', '/api/stats/rooms'], async (req, res) => webResponse(await historyListing(webRequest(req), config, getDatabase()), res));

app.all('/api/stats/videos/restore', express.text({ type: '*/*', limit: '8kb' }), async (req, res) => webResponse(await restoreHistoryResponse(webRequest(req), config, ids => {
    const result = archiveWork.then(async () => {
        const database = getDatabase();
        if (!database) throw new HistoryError('Die Statistik-Datenbank ist nicht eingerichtet.');
        return database.restoreVideos(ids);
    });
    archiveWork = result.catch(() => {}); return result;
}, (ids, account) => authorizeRestore(getDatabase(), ids, account, config)), res));

app.all(['/api/stats/rooms/*path', '/api/stats/videos/*path'], async (req, res) => webResponse(await historyResponse(webRequest(req), config, async command => {
    const database = getDatabase();
    const video = await historyVideo(database, command);
    const needsRoom = !video?.roomDeleted && !command.restore;
    const room = rooms.get(command.code);
    if (needsRoom && ((room && room.state !== 'GAME_OVER') || pendingStarts.has(command.code))) throw new HistoryError('Der Raum wird noch gespielt. Beende die Partie zuerst.', 409);
    if (needsRoom) pendingStarts.add(command.code);
    try {
        if (needsRoom) {
            await persistence.get(command.code);
            try { await flushWrites(command); } catch { throw new HistoryError('Die Partie wird noch gespeichert. Bitte versuche es gleich erneut.'); }
        }
        const deletion = archiveWork.then(() => deleteStoredHistory(database, command, async time => { scheduleVideoCleanup(time); }));
        archiveWork = deletion.catch(() => {});
        const result = await deletion;
        if (!command.roundNumber && !command.videoId) {
            await deleteSharedImage(imageStorage, room?.sharedImage);
            rooms.delete(command.code);
            for (const socket of await io.in(command.code).fetchSockets()) {
                socket.data.roomId = undefined;
                socket.emit('leftRoom'); await socket.leave(command.code);
            }
        } else if (!video?.roomDeleted && !command.restore && room && (room.videoNumber || room.currentRound) === command.roundNumber) room.currentVideoUrl = '';
        return result;
    } finally { if (needsRoom) pendingStarts.delete(command.code); }
}, async id => {
    const database = getDatabase();
    if (!database) throw new HistoryError('Die Statistik-Datenbank ist nicht eingerichtet.');
    return database.savedVideo(id);
}, (command, account) => authorizeHistory(getDatabase(), command, account, config)), res));

function broadcast(room: Room) {
    syncPhase(room);
    for (const player of participants(room)) if (player.connected) {
        const socket = io.sockets.sockets.get(player.connectionId || player.id);
        if (!socket) continue;
        if (authDisabled(config)) { socket.emit('roomDataUpdate', roomSnapshot(room, player.id)); continue; }
        if (socket.data.checkingSnapshot) continue;
        socket.data.checkingSnapshot = true;
        const account = socket.data.account;
        void accountIsCurrent(account, config).then(valid => {
            socket.data.checkingSnapshot = false;
            if (!socket.connected) return;
            if (socket.data.account !== account) { const current = rooms.get(socket.data.roomId); if (current) broadcast(current); return; }
            if (!valid || account.expiresAt <= Date.now()) { socket.emit('authExpired'); socket.disconnect(true); return; }
            const current = rooms.get(socket.data.roomId), member = current && participantForConnection(current, socket.id);
            if (current && member) socket.emit('roomDataUpdate', roomSnapshot(current, member.id));
        }).catch(() => { socket.data.checkingSnapshot = false; socket.emit('roomNotice', 'Die Sitzungsprüfung ist gerade nicht erreichbar.'); });
    }
}

function runGeneration(room: Room, generationId: string, image?: string) {
    let pending = false, uncertain = false;
    const progress = (step: string) => {
        if (rooms.get(room.code) === room && room.generationId === generationId) io.to(room.code).emit('generationProgress', { step });
    };
    const lifecycle = {
        context: { generationId, roomCode: room.code, videoNumber: room.videoNumber || room.currentRound },
        saveJob: async (job: NonNullable<Room['generationJob']>) => {
            if (rooms.get(room.code) === room && room.generationId === generationId) room.generationJob = job;
        }
    };
    const generation = room.generationJob?.status === 'complete' && room.generationJob.videoUrl ? Promise.resolve(room.generationJob.videoUrl)
        : budget.tokenForJob(room.code, generationId).catch(error => {
        if (room.generationJob) {
            if (Date.now() - room.generationJob.submittedAt >= AI_JOB_MAX_AGE_MS) throw new AiExpiredError();
            throw new AiPendingError(room.generationJob);
        }
        throw error;
    }).then(token => {
        const generationConfig = qualityConfig({ ...config, HF_TOKEN: token }, gameOptions(room.options).quality);
        return image ? generateAiVideo(image, room.currentPrompt, generationConfig, progress,
            seconds => withBudget(() => budget.allowAttempt(room.code, seconds, generationId)), lifecycle)
            : resumeAiVideo(room.generationJob!, generationConfig, progress, lifecycle);
    });
    void generation.then(async videoUrl => {
        if (rooms.get(room.code) !== room || room.generationId !== generationId) return videoUrl;
        progress('Video wird geprüft und gespeichert …');
        try { return await archive(videoUrl, room.code, room.generationJob ? { generationId, submittedAt: room.generationJob.submittedAt } : undefined); }
        catch (error) { throw archiveRecovery(error, room.generationJob); }
    }).then(videoUrl => {
        if (rooms.get(room.code) !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
        room.state = 'VOTING'; room.currentVideoUrl = videoUrl;
        broadcast(room);
    }).catch(error => {
        pending = error instanceof AiPendingError;
        uncertain = error instanceof AiExpiredError;
        if (rooms.get(room.code) !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
        if (pending) {
            room.generationJob = (error as AiPendingError).job;
            progress(room.generationJob.status === 'complete' ? 'Video ist fertig. Inhaltsprüfung und Speicherung werden erneut versucht …' : 'Videoerstellung läuft weiter...');
            setTimeout(() => {
                if (rooms.get(room.code) === room && room.generationId === generationId && room.state === 'GENERATING') runGeneration(room, generationId);
            }, AI_RETRY_MS);
            return;
        }
        room.state = 'IDLE'; room.generationId = undefined; room.generationJob = undefined;
        broadcast(room);
        io.to(room.code).emit('errorMsg', error instanceof Error ? error.message : 'Generierung fehlgeschlagen.');
    }).finally(async () => {
        if (!pending && !uncertain) await withBudget(() => budget.consume(room.code, generationId));
        await refreshLobbyQuota(room);
    }).catch(() => logAiEvent('callback_failed', { ...lifecycle.context, errorCode: 'service' }));
}

async function refreshLobbyQuota(room: Room) {
    if (rooms.get(room.code) !== room || !room.players.length) return;
    if (room.state !== 'LOBBY' && room.state !== 'GAME_OVER') return;
    const state = room.state, video = room.videoNumber;
    const players = room.players.length;
    const quality = gameOptions(room.options).quality;
    const mode = gameOptions(room.options).mode;
    const capacity = isArchiveGame(room) ? archiveCapacity(await playableArchive(room), players) : await budget.capacity(players, quality, room.players);
    if (rooms.get(room.code) !== room || room.state !== state || video !== room.videoNumber || players !== room.players.length || quality !== gameOptions(room.options).quality || mode !== gameOptions(room.options).mode) return;
    if (state === 'GAME_OVER') room.extensionQuota = capacity;
    else {
        room.quota = capacity;
        const rounds = capacity.aiRoundLimit ? maxRounds(room.maxRounds || 1, capacity.aiRoundLimit) : 0;
        if (rounds !== room.maxRounds) resetReady(room);
        room.maxRounds = rounds;
    }
    broadcast(room);
}

// Queue writes per room to preserve create -> join -> round -> final standings order.
const pendingWrites = new Map<string, (() => Promise<void>)[]>();
async function flushWrites(room: { code: string }) {
    const writes = pendingWrites.get(room.code);
    while (writes?.length) { await writes[0](); writes.shift(); }
    pendingWrites.delete(room.code);
}
function persist(room: Room, action: () => Promise<void>) {
    const writes = pendingWrites.get(room.code) || []; writes.push(action); pendingWrites.set(room.code, writes);
    const next = (persistence.get(room.code) || Promise.resolve()).then(() => flushWrites(room)).catch(error => {
        operationFailure('persistence', error);
        io.to(room.code).emit('roomNotice', 'Die Statistik-Speicherung ist momentan nicht erreichbar.');
    });
    persistence.set(room.code, next);
    void next.finally(() => { if (persistence.get(room.code) === next) persistence.delete(room.code); });
}

function persistMembers(room: Room) {
    if (isArchiveGame(room) || room.state === 'LOBBY') return;
    const snapshot = structuredClone(room);
    persist(room, async () => {
        await saveRoom(snapshot.code, snapshot.hostId, snapshot.maxRounds);
        await saveScores(snapshot.code, snapshot.players, snapshot.hostId);
        if (snapshot.state !== 'LOBBY') await markRoomStarted(snapshot.code);
    });
}

function checkVotingComplete(room: Room, confirmedSolo = false) {
    if (!finishVoting(room, confirmedSolo)) return;
    completeVoting(room);
}
function completeVoting(room: Room) {
    if (room.state === 'GAME_OVER') void withBudget(() => budget.release(room.code));
    const snapshot = structuredClone(room);
    broadcast(room);
    if (!isArchiveGame(room)) persist(room, () => saveRound(roundInput(snapshot)));
    if (room.state === 'GAME_OVER') void refreshLobbyQuota(room);
}

function endPhase(room: Room) {
    const creatorId = activeCreator(room)?.id;
    const result = closePhase(room);
    if (result === 'voted') completeVoting(room);
    else if (result) {
        if (result === 'skipped' && !isArchiveGame(room)) void withBudget(() => budget.drop(room.code, 1, creatorId));
        if (room.state === 'GAME_OVER') {
            void withBudget(() => budget.release(room.code));
            if (!isArchiveGame(room)) persist(room, () => markRoomFinished(room.code, finalStandings(room)));
            void refreshLobbyQuota(room);
        }
        broadcast(room);
    }
}
const phaseClock = setInterval(() => {
    for (const room of rooms.values()) if (room.phaseDeadline && room.phaseDeadline <= Date.now()) endPhase(room);
}, 500);
phaseClock.unref();

function leave(room: Room, player: Player) {
    const timer = disconnectTimers.get(player.sessionId);
    if (timer) clearTimeout(timer);
    disconnectTimers.delete(player.sessionId);
    if (isSpectator(room, player)) { room.spectators = room.spectators?.filter(p => p.id !== player.id); broadcast(room); return; }
    const wasOver = room.state === 'GAME_OVER';
    const skipped = removePlayer(room, player.id);
    playArchiveVideo(room);
    if (skipped) void withBudget(() => budget.drop(room.code, skipped, player.id));
    if (!room.players.length) {
        for (const viewer of room.spectators || []) {
            const socket = io.sockets.sockets.get(viewer.connectionId || viewer.id);
            if (socket) { socket.data.roomId = undefined; socket.emit('leftRoom'); void socket.leave(room.code); }
        }
        rooms.delete(room.code); void deleteSharedImage(imageStorage, room.sharedImage); void withBudget(() => budget.release(room.code)); return;
    }
    io.to(room.code).emit('roomNotice', `${player.name} hat das Spiel verlassen.`);
    if (!wasOver && room.state === 'GAME_OVER') {
        void withBudget(() => budget.release(room.code));
        const standings = finalStandings(room);
        if (!isArchiveGame(room)) persist(room, () => markRoomFinished(room.code, standings));
    }
    checkVotingComplete(room);
    broadcast(room);
    if (room.state === 'LOBBY') room.quota = undefined;
    if (room.state === 'GAME_OVER') room.extensionQuota = undefined;
    void refreshLobbyQuota(room);
}

function member(socket: Socket, payload: Record<string, unknown>, allowSpectator = false) {
    const code = sanitizeRoomId(payload.roomId);
    const room = rooms.get(code);
    const player = room && participantForConnection(room, socket.id);
    if (!room || !player || socket.data.roomId !== code) throw new Error('Bitte verbinde dich zuerst mit dem Raum.');
    if (!allowSpectator && isSpectator(room, player)) throw new Error('Als Zuschauer kannst du diese Aktion nicht ausführen.');
    return { room, player };
}

function enter(socket: Socket, room: Room, player: Player, event: string) {
    socket.data.roomId = room.code;
    player.connectionId = socket.id;
    player.hfConnectionId = isSpectator(room, player) ? undefined : socket.data.account?.hfConnectionId;
    void socket.join(room.code);
    socket.emit(event, { roomId: room.code, sessionId: player.sessionId, playerId: player.id, gameState: room.state });
    broadcast(room);
}

io.on('connection', (socket: Socket) => {
    const unjoinedTimer = setTimeout(() => { if (!socket.data.roomId) socket.disconnect(true); }, 60_000);
    unjoinedTimer.unref(); socket.once('disconnect', () => clearTimeout(unjoinedTimer));
    function charge(event: string, payload: unknown) {
        try {
            const actor = socket.data.account?.id || socket.id;
            if (takeRateLimit(messageBuckets, actor, MESSAGE_RATE) || takeRateLimit(messageBuckets, `bytes:${actor}`, MESSAGE_BYTES, Date.now(), payloadBytes(payload))) throw new Error(RATE_MESSAGE);
            const rule = expensiveMessageRule(event);
            if (rule && takeRateLimit(messageBuckets, `${event}:${actor}`, rule)) throw new Error(RATE_MESSAGE);
            return true;
        } catch (error) { socket.emit('errorMsg', error instanceof Error ? error.message : RATE_MESSAGE); return false; }
    }
    function on(event: string, handler: (payload: Record<string, unknown>) => void | Promise<void>) {
        socket.on(event, (payload: unknown) => {
            if (!charge(event, payload)) return;
            const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
            void Promise.resolve().then(async () => {
                if (!authDisabled(config) && (!socket.data.account || socket.data.account.expiresAt < Date.now())) { socket.emit('authExpired'); return; }
                if (!authDisabled(config) && !await accountIsCurrent(socket.data.account, config)) {
                    const room = rooms.get(socket.data.roomId);
                    const player = room && participantForConnection(room, socket.id);
                    if (room && player) leave(room, player);
                    socket.emit('authExpired'); socket.disconnect(true); return;
                }
                await handler(data);
            }).catch(error => socket.emit(error instanceof HfRequiredError ? 'hfRequired' : 'errorMsg', error instanceof Error ? error.message : 'Nachricht konnte nicht verarbeitet werden.'));
        });
    }
    socket.on('refreshAuth', (payload: { token: unknown }) => {
        if (!charge('refreshAuth', payload)) return;
        void verifyAccountToken(payload?.token, config).then(account => { if (account.id === socket.data.account?.id) socket.data.account = { ...account, hfConnectionId: socket.data.account?.hfConnectionId }; }).catch(() => socket.emit('authExpired'));
    });

    on('createRoom', async payload => {
        if (socket.data.roomId || socket.data.creatingRoom) throw new Error('Du bist bereits in einem Raum.');
        const name = socket.data.account?.name || sanitizeUsername(payload.username);
        if (!name) throw new Error('Bitte gib einen Spielernamen ein.');
        socket.data.creatingRoom = true;
        try {
            await requirePlayerHf(config, socket.data.account, hf);
            const capacity = await budget.capacity(1, 'auto', socket.data.account?.hfConnectionId ? [{ id: socket.id, accountId: socket.data.account.id, hfConnectionId: socket.data.account.hfConnectionId }] : undefined);
            let code: string;
            do { code = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase(); } while (await roomExists(code) || rooms.has(code));
            if (!socket.connected) return;
            const player: Player = { id: socket.id, accountId: socket.data.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || randomUUID(), name, score: 0, connected: true };
            const room: Room = { code, hostId: player.id, players: [player], state: 'LOBBY',
                activeCreatorIndex: 0, currentVotes: {}, currentRound: 1, maxRounds: capacity.aiRoundLimit ? maxRounds(payload.maxRounds, capacity.aiRoundLimit) : 0,
                currentPrompt: '', currentVideoUrl: '', quota: capacity, options: gameOptions(), imageProfile: 'bounded' };
            rooms.set(code, room);
            enter(socket, room, player, 'roomCreated');
            persistMembers(room);
        } finally { socket.data.creatingRoom = false; }
    });

    on('joinRoom', async payload => {
        if (socket.data.roomId) throw new Error('Du bist bereits in einem Raum.');
        const room = rooms.get(sanitizeRoomId(payload.roomId));
        if (!room) throw new Error('Raum wurde nicht gefunden.');
        const spectator = payload.role === 'spectator';
        if (room.rematch?.initialized) throw new Error('Diese Partie ist abgeschlossen. Bitte verwende den neuen Raumcode.');
        const name = socket.data.account?.name || sanitizeUsername(payload.username);
        if (!name) throw new Error('Bitte gib einen Spielernamen ein.');
        checkJoin(room, name, socket.data.account?.id, spectator);
        if (!spectator) await requirePlayerHf(config, socket.data.account, hf);
        if (rooms.get(room.code) !== room || socket.data.roomId) throw new Error('Der Raum hat sich geändert. Bitte erneut beitreten.');
        checkJoin(room, name, socket.data.account?.id, spectator);
        const player: Player = { id: socket.id, accountId: socket.data.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || randomUUID(), name, score: 0, connected: true };
        if (participants(room).some(p => p.sessionId === player.sessionId)) throw new Error('Diese Sitzung ist bereits im Raum.');
        if (spectator) (room.spectators ??= []).push(player);
        else { room.players.push(player); resetReady(room); room.quota = undefined; }
        enter(socket, room, player, 'joinedSuccess');
        if (!spectator) { await refreshLobbyQuota(room); persistMembers(room); }
    });

    on('resumeRoom', async payload => {
        const room = rooms.get(sanitizeRoomId(payload.roomId));
        const player = room && participants(room).find(p => p.sessionId === sanitizeSessionId(payload.sessionId));
        if (!room || !player || (!authDisabled(config) && player.accountId !== socket.data.account?.id)) { socket.emit('resumeFailed'); return; }
        if (room.rematch?.initialized && room.rematch.transfers[player.id]) { socket.emit('roomTransfer', room.rematch.transfers[player.id]); return; }
        if (socket.data.roomId && socket.data.roomId !== room.code) throw new Error('Du bist bereits in einem Raum.');
        if (!isSpectator(room, player)) await requirePlayerHf(config, socket.data.account, hf);
        if (rooms.get(room.code) !== room || !participants(room).includes(player)) { socket.emit('resumeFailed'); return; }
        const timer = disconnectTimers.get(player.sessionId);
        if (timer) clearTimeout(timer);
        disconnectTimers.delete(player.sessionId);
        const old = io.sockets.sockets.get(player.connectionId || player.id);
        player.connectionId = socket.id;
        player.connected = true;
        player.disconnectedAt = undefined;
        if (old && old !== socket) { old.data.roomId = undefined; old.emit('sessionReplaced'); old.disconnect(true); }
        enter(socket, room, player, 'resumeSuccess');
        await refreshLobbyQuota(room);
    });

    on('leaveRoom', payload => {
        const { room, player } = member(socket, payload, true);
        void socket.leave(room.code);
        socket.data.roomId = undefined;
        leave(room, player);
        socket.emit('leftRoom');
    });

    on('refreshQuota', async payload => { const { room } = member(socket, payload); await refreshLobbyQuota(room); });
    on('setReady', payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'LOBBY' || typeof payload.ready !== 'boolean') return;
        player.ready = payload.ready; broadcast(room);
    });
    on('setGameOptions', async payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'LOBBY' || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        room.options = gameOptions(payload.options); resetReady(room); room.quota = undefined; broadcast(room);
        await refreshLobbyQuota(room); persistMembers(room);
    });
    on('setSharedImage', async payload => {
        const { room, player } = member(socket, payload);
        const recovering = room.state === 'IDLE' && gameOptions(room.options).sharedImage && (!room.sharedImage || room.sharedImage.expiresAt <= Date.now());
        if ((!['LOBBY', 'GAME_OVER'].includes(room.state) && !recovering) || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        const state = room.state;
        pendingStarts.add(room.code);
        try {
            const image = await writeSharedImage(imageStorage, payload.imageBase64, config), old = room.sharedImage;
            if (rooms.get(room.code) !== room || room.hostId !== player.id || room.state !== state) { await deleteSharedImage(imageStorage, image); return; }
            room.sharedImage = image; resetReady(room); await deleteSharedImage(imageStorage, old); broadcast(room);
            setTimeout(() => {
                if (room.sharedImage?.id === image.id && image.expiresAt <= Date.now()) {
                    room.sharedImage = undefined; resetReady(room); void deleteSharedImage(imageStorage, image);
                    if (rooms.get(room.code) === room) broadcast(room);
                }
            }, Math.max(0, image.expiresAt - Date.now())).unref();
        } finally { pendingStarts.delete(room.code); }
    });
    on('setRoundCount', async payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'LOBBY' || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        await refreshLobbyQuota(room);
        if (room.state !== 'LOBBY' || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        if (!room.quota?.aiRoundLimit) throw new Error('Das KI-Kontingent reicht derzeit nicht für eine vollständige Runde mit allen Spielern.');
        room.maxRounds = maxRounds(payload.rounds, room.quota.aiRoundLimit); resetReady(room);
        broadcast(room);
        persistMembers(room);
    });

    on('startGame', async payload => {
        const { room, player } = member(socket, payload);
        if (room.hostId !== player.id || room.state !== 'LOBBY') return;
        if (startProblem(room)) throw new Error(startProblem(room));
        if (pendingStarts.has(room.code)) return;
        pendingStarts.add(room.code);
        const roster = room.players.map(p => p.id).join(',');
        try {
            if (gameOptions(room.options).sharedImage) await readSharedImage(imageStorage, room.sharedImage);
            await refreshLobbyQuota(room);
            if (!room.maxRounds || roster !== room.players.map(p => p.id).join(',')) throw new Error('Das Kontingent oder die Spielerzahl hat sich geändert. Bitte prüfe die Rundenauswahl.');
            if (isArchiveGame(room)) prepareArchive(room, await playableArchive(room));
            else await withBudget(() => budget.reserve(room.code, room.maxRounds, room.players.length, gameOptions(room.options).quality, room.players));
            if (rooms.get(room.code) !== room || room.hostId !== player.id || room.state !== 'LOBBY' || roster !== room.players.map(p => p.id).join(',') || startProblem(room)) { await withBudget(() => budget.release(room.code)); throw new Error(startProblem(room) || 'Die Spielerzahl hat sich geändert.'); }
            startRounds(room);
            playArchiveVideo(room);
            broadcast(room);
            persistMembers(room);
        }
        finally { pendingStarts.delete(room.code); }
    });

    on('sendImage', async payload => {
        const { room, player } = member(socket, payload);
        if (isArchiveGame(room) || room.state !== 'IDLE' || activeCreator(room)?.id !== player.id) return;
        const prompt = validatePrompt(payload.prompt);
        generationSafetyReady(config);
        if (AI_PROVIDER !== 'mock') approvedProvider(config);
        const imageBase64 = await normalizeImage(gameOptions(room.options).sharedImage ? await readSharedImage(imageStorage, room.sharedImage) : payload.imageBase64);
        await moderateInput(imageBase64, buildVideoPrompt(prompt), config);
        const image = validateImage(imageBase64);
        if (room.imageProfile === 'bounded') preparedImageSize(image.base64);
        if (rooms.get(room.code) !== room || room.state !== 'IDLE' || activeCreator(room)?.id !== player.id) return;
        if (AI_PROVIDER !== 'mock' && !archiveEnabled(config)) throw new Error('Der Videospeicher ist nicht eingerichtet. Bitte die Storage-Schlüssel auf dem Server hinterlegen.');
        const generationId = randomUUID();
        room.generationId = generationId;
        // Lock the turn before the quota request yields to another image submission.
        room.state = 'GENERATING';
        try { await withBudget(() => budget.begin(room.code, remainingVideos(room), generationId, player.id, remainingVideosFor(room, player.id), player)); } catch (error) { if (room.generationId === generationId) room.state = 'IDLE'; throw error; }
        if (rooms.get(room.code) !== room || room.generationId !== generationId || activeCreator(room)?.id !== player.id) { await withBudget(() => budget.consume(room.code, generationId)); return; }
        room.state = 'GENERATING'; room.generationId = generationId;
        room.currentPrompt = prompt; room.currentVideoUrl = ''; room.currentVotes = {};
        broadcast(room);
        room.generationJob = undefined;
        runGeneration(room, generationId, imageBase64 as string);
    });

    on('submitVote', payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'VOTING' || room.currentVotes[player.id] !== undefined) return;
        recordVote(room, player, payload);
        checkVotingComplete(room);
        broadcast(room);
    });
    on('judgeGuesses', payload => {
        const { room, player } = member(socket, payload);
        if (judgeGuesses(room, player, payload)) { checkVotingComplete(room); broadcast(room); }
    });

    on('finishPreview', payload => {
        const { room, player } = member(socket, payload);
        if (room.players.length !== 1 || activeCreator(room)?.id !== player.id
            || Number(payload.videoNumber) !== (room.videoNumber || room.currentRound)) return;
        checkVotingComplete(room, true);
    });

    on('startNextRound', payload => {
        const { room, player } = member(socket, payload);
        if (room.hostId !== player.id || room.state !== 'RESULTS') return;
        advanceTurn(room);
        playArchiveVideo(room);
        broadcast(room);
    });

    on('closePhase', payload => {
        const { room, player } = member(socket, payload);
        if (room.hostId !== player.id || payload.phaseKey !== room.phaseKey) return;
        endPhase(room);
    });

    on('extendGame', async payload => {
        const { room, player } = member(socket, payload);
        if (isArchiveGame(room)) throw new Error('Starte für weitere Archivvideos eine neue Partie.');
        if (room.state !== 'GAME_OVER' || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        if (Number(payload.completedVideo) !== (room.videoNumber || room.currentRound)) return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        pendingStarts.add(room.code);
        const roster = room.players.map(p => p.id).join(',');
        try {
            if (gameOptions(room.options).sharedImage) await readSharedImage(imageStorage, room.sharedImage);
            await refreshLobbyQuota(room);
            if (room.state !== 'GAME_OVER' || room.hostId !== player.id || roster !== room.players.map(p => p.id).join(',')) throw new Error('Die Spielerzahl hat sich geändert. Bitte versuche es erneut.');
            await withBudget(() => budget.extend(room.code, room.players.length, gameOptions(room.options).quality, room.players));
            if (rooms.get(room.code) !== room || room.state !== 'GAME_OVER' || room.hostId !== player.id || roster !== room.players.map(p => p.id).join(',') || room.players.some(p => !p.connected)) {
                await withBudget(() => budget.drop(room.code, roster.split(',').length));
                throw new Error('Die Spielerzahl oder Verbindung hat sich geändert. Bitte versuche es erneut.');
            }
            extendRound(room);
            const snapshot = structuredClone(room);
            persist(room, () => reopenRoom(snapshot.code, snapshot.maxRounds, snapshot.hostId));
            broadcast(room);
        } finally { pendingStarts.delete(room.code); }
    });

    on('rematchGame', async payload => {
        const { room, player } = member(socket, payload);
        if (room.hostId !== player.id || room.state !== 'GAME_OVER' || pendingStarts.has(room.code)) return;
        if (room.rematch?.initialized) return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        pendingStarts.add(room.code);
        const roster = participants(room).filter(p => p.connected).map(p => p.id).join(',');
        try {
            await persistence.get(room.code);
            try { await flushWrites(room); } catch { throw new Error('Die Partie wird noch gespeichert. Bitte versuche es gleich erneut.'); }
            let code: string;
            do { code = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase(); } while (await roomExists(code) || rooms.has(code));
            const plan = prepareRematch(room, code), next = plan.room;
            next.quota = isArchiveGame(next) ? archiveCapacity(await playableArchive(next), next.players.length)
                : await budget.capacity(next.players.length, gameOptions(next.options).quality, next.players);
            next.maxRounds = next.quota.aiRoundLimit ? maxRounds(next.maxRounds || 1, next.quota.aiRoundLimit) : 0;
            if (room.state !== 'GAME_OVER' || room.hostId !== player.id || roster !== participants(room).filter(p => p.connected).map(p => p.id).join(',') || room.players.some(p => !p.connected)) throw new Error('Die Gruppe hat sich geändert. Bitte versuche es erneut.');
            // No await between the final collision check and registering the new room.
            if (rooms.has(code)) throw new Error('Der Raumcode wurde gerade vergeben. Bitte erneut versuchen.');
            rooms.set(code, next); room.rematch = plan; plan.initialized = true;
            for (const old of participants(room)) {
                const transfer = plan.transfers[old.id], connection = io.sockets.sockets.get(old.connectionId || old.id);
                if (!transfer || !connection) continue;
                const fresh = participants(next).find(p => p.id === transfer.playerId)!;
                await connection.leave(room.code); await connection.join(next.code);
                fresh.connected = true; fresh.connectionId = connection.id; fresh.disconnectedAt = undefined;
                connection.data.roomId = next.code; connection.emit('roomTransfer', transfer);
            }
            broadcast(next);
        } finally { pendingStarts.delete(room.code); }
    });

    socket.on('disconnect', () => {
        const room = rooms.get(socket.data.roomId);
        const player = room && participantForConnection(room, socket.id);
        if (!room || !player) return;
        player.connected = false; player.ready = false; player.disconnectedAt = Date.now();
        broadcast(room);
        disconnectTimers.set(player.sessionId, setTimeout(() => {
            if (!player.connected && rooms.get(room.code) === room) leave(room, player);
        }, DISCONNECT_GRACE_MS));
    });
});

io.use((socket, next) => {
    const request = new Request('http://localhost/', { headers: { cookie: socket.handshake.headers.cookie || '' } });
    void requestAccount(request, config).then(account => { socket.data.account = account; next(); }).catch(() => next(new Error('Bitte melde dich an.')));
});

server.on('error', error => {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(code === 'EADDRINUSE' ? `Port ${PORT} ist belegt. Starte mit PORT=${PORT + 1} npm run dev.` : error.message);
    process.exitCode = 1;
});
ensureDatabaseSchema().then(() => server.listen(PORT, () => console.log(`Server läuft auf http://127.0.0.1:${PORT}`)))
    .catch(error => { operationFailure('startup', error); process.exitCode = 1; });
