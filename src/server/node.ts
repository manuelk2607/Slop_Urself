import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import { AuthConfig, requestAccount, sessionResponse, verifyAccountToken, authDisabled } from '../auth/session';
import { QuotaBudget, QuotaConfig, playerCount } from '../ai/quota';
import { ArchiveConfig, archiveVideo, serveVideo, listArchive, archiveEnabled, archiveLimit } from '../storage/archive';
import { Server, Socket } from 'socket.io';
import { generateAiVideo, resumeAiVideo, AiPendingError, AiExpiredError, AI_RETRY_MS, validateImage, DEFAULT_PROVIDER_CHAIN } from '../ai/generation';
import { takeRateLimit, rateKey, httpRateRule, MESSAGE_RATE, RATE_MESSAGE, type RateBuckets } from '../security/rate-limit';
import { logAiEvent } from '../ai/telemetry';
import {
    Room, Player, activeCreator, playerForConnection, roomSnapshot, finishVoting, finalStandings,
    removePlayer, sanitizeUsername, sanitizeRoomId, sanitizeSessionId, roundLimit, maxRounds,
    DISCONNECT_GRACE_MS, SOLO_PREVIEW_MS, startRounds, advanceTurn, remainingVideos, extendRound
} from '../game/rules';
import { ensureDatabaseSchema, getProfiles, getStats, isDatabaseEnabled, markRoomStarted, markRoomFinished, saveRoom, saveScores, saveRound, roomExists, reopenRoom } from '../database/node';
import { roundInput } from '../game/persistence';

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
const config: AuthConfig & QuotaConfig & ArchiveConfig = { ...process.env, AI_PROVIDER, AI_PROVIDER_CHAIN };
const budget = new QuotaBudget({ get: async <T>(key: string) => structuredClone(budgetData.get(key)) as T | undefined, put: async (key, value) => { budgetData.set(key, structuredClone(value)); } }, config);
let budgetWork: Promise<unknown> = Promise.resolve();
let archiveWork: Promise<unknown> = Promise.resolve();
function withBudget<T>(action: () => Promise<T>): Promise<T> { const result = budgetWork.then(action); budgetWork = result.catch(() => {}); return result; }
function archive(url: string) { const result = archiveWork.then(() => archiveVideo(url, config)); archiveWork = result.catch(() => {}); return result; }
app.use(async (req, res, next) => {
    const rule = httpRateRule(req.path, req.method);
    if (rule) {
        const key = await rateKey(req.socket.remoteAddress || 'local', req.path, config.AUTH_COOKIE_SECRET);
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
    res.send(Buffer.from(await response.arrayBuffer()));
}
app.use('/api/auth', (_req, res) => res.sendStatus(404));
app.all('/api/session', express.text({ type: '*/*', limit: '2kb' }), async (req, res) => webResponse(await sessionResponse(webRequest(req), config, getProfiles()), res));
app.use('/api/videos', async (req, res) => {
    try { await requestAccount(webRequest(req), config); } catch { res.sendStatus(401); return; }
    await webResponse(await serveVideo(webRequest(req), req.originalUrl.split('/api/videos/')[1], config), res);
});

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'index.html')));
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'favicon.ico')));
app.get('/apple-touch-icon.png', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'apple-touch-icon.png')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'style.css')));
app.get('/script.js', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'script.js')));
app.get('/startup.js', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'startup.js')));
app.use('/assets', express.static(path.join(PUBLIC_ROOT, 'assets')));
app.get('/api/config', async (req, res) => {
    let players: number;
    try { players = playerCount(req.query.players ?? 1); } catch { res.status(400).json({ error: 'Ungueltige Spielerzahl.' }); return; }
    const signedIn = authDisabled(config) || Boolean(await requestAccount(webRequest(req), config).catch(() => undefined));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        ...(signedIn ? await withBudget(() => budget.displayCapacity(players)) : { aiRoundLimit: 0, quotaMode: 'unavailable' }), authEnabled: !authDisabled(config),
        aiProvider: AI_PROVIDER === 'mock' ? 'mock' : AI_PROVIDER_CHAIN,
        mockAi: AI_PROVIDER === 'mock', videoDuration: Math.max(5, Number(process.env.LTX_DURATION) || 5)
    });
});
app.get('/api/stats', async (req, res) => {
    try { await requestAccount(webRequest(req), config); } catch { res.sendStatus(401); return; }
    try { const objects = await listArchive(config).catch(() => null); res.json({ databaseEnabled: isDatabaseEnabled(), ...await getStats(), videoStorageMode: archiveEnabled(config) ? 'archive' : 'url', archive: objects ? { usedBytes: objects.reduce((sum, object) => sum + object.size, 0), maxBytes: archiveLimit(config), videoCount: objects.length } : null }); }
    catch (error) {
        console.error('[DB] Statistics unavailable', error instanceof Error ? error.message : 'Database error');
        res.status(503).json({ error: 'Statistiken konnten nicht geladen werden.' });
    }
});

function broadcast(room: Room) { io.to(room.code).emit('roomDataUpdate', roomSnapshot(room)); }

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
    const generation = image ? generateAiVideo(image, room.currentPrompt, config, progress,
        seconds => withBudget(() => budget.allowAttempt(room.code, seconds, generationId)), lifecycle)
        : resumeAiVideo(room.generationJob!, config, progress, lifecycle);
    void generation.then(videoUrl => {
        if (rooms.get(room.code) !== room || room.generationId !== generationId) return videoUrl;
        return archive(videoUrl).catch(() => {
            io.to(room.code).emit('roomNotice', 'Das Video kann gerade nicht archiviert werden. Der temporaere Link bleibt abspielbar.'); return videoUrl;
        });
    }).then(videoUrl => {
        if (rooms.get(room.code) !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
        room.state = 'VOTING'; room.currentVideoUrl = videoUrl;
        if (room.players.length === 1) {
            room.soloFinishAt = Date.now() + SOLO_PREVIEW_MS;
            setTimeout(() => { if (rooms.get(room.code) === room && room.generationId === generationId) checkVotingComplete(room); }, SOLO_PREVIEW_MS);
        }
        broadcast(room);
    }).catch(error => {
        pending = error instanceof AiPendingError;
        uncertain = error instanceof AiExpiredError;
        if (rooms.get(room.code) !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
        if (pending) {
            room.generationJob = (error as AiPendingError).job;
            progress('Videoerstellung laeuft weiter...');
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
    const capacity = await withBudget(() => budget.capacity(players));
    if (rooms.get(room.code) !== room || room.state !== state || video !== room.videoNumber || players !== room.players.length) return;
    if (state === 'GAME_OVER') room.extensionQuota = capacity;
    else {
        room.quota = capacity;
        room.maxRounds = capacity.aiRoundLimit ? maxRounds(room.maxRounds || 1, capacity.aiRoundLimit) : 0;
    }
    broadcast(room);
}

// Queue writes per room to preserve create -> join -> round -> final standings order.
function persist(room: Room, action: () => Promise<void>) {
    const next = (persistence.get(room.code) || Promise.resolve()).then(action).catch(error => {
        console.error('[DB] Persistence failed', error instanceof Error ? error.message : 'Database error');
        io.to(room.code).emit('roomNotice', 'Die Statistik-Speicherung ist momentan nicht erreichbar.');
    });
    persistence.set(room.code, next);
    void next.finally(() => { if (persistence.get(room.code) === next) persistence.delete(room.code); });
}

function persistMembers(room: Room) {
    const snapshot = structuredClone(room);
    persist(room, async () => {
        await saveRoom(snapshot.code, snapshot.hostId, snapshot.maxRounds);
        await saveScores(snapshot.code, snapshot.players, snapshot.hostId);
        if (snapshot.state !== 'LOBBY') await markRoomStarted(snapshot.code);
    });
}

function checkVotingComplete(room: Room) {
    if (!finishVoting(room)) return;
    if (room.state === 'GAME_OVER') void withBudget(() => budget.release(room.code));
    const snapshot = structuredClone(room);
    broadcast(room);
    persist(room, () => saveRound(roundInput(snapshot)));
    if (room.state === 'GAME_OVER') void refreshLobbyQuota(room);
}

function leave(room: Room, player: Player) {
    const timer = disconnectTimers.get(player.sessionId);
    if (timer) clearTimeout(timer);
    disconnectTimers.delete(player.sessionId);
    const wasOver = room.state === 'GAME_OVER';
    const skipped = removePlayer(room, player.id);
    if (skipped) void withBudget(() => budget.drop(room.code, skipped));
    if (!room.players.length) { rooms.delete(room.code); void withBudget(() => budget.release(room.code)); return; }
    io.to(room.code).emit('roomNotice', `${player.name} hat das Spiel verlassen.`);
    if (!wasOver && room.state === 'GAME_OVER') {
        void withBudget(() => budget.release(room.code));
        const standings = finalStandings(room);
        persist(room, () => markRoomFinished(room.code, standings));
    }
    checkVotingComplete(room);
    broadcast(room);
    if (room.state === 'LOBBY') room.quota = undefined;
    if (room.state === 'GAME_OVER') room.extensionQuota = undefined;
    void refreshLobbyQuota(room);
}

function member(socket: Socket, payload: Record<string, unknown>) {
    const code = sanitizeRoomId(payload.roomId);
    const room = rooms.get(code);
    const player = room && playerForConnection(room, socket.id);
    if (!room || !player || socket.data.roomId !== code) throw new Error('Bitte verbinde dich zuerst mit dem Raum.');
    return { room, player };
}

function enter(socket: Socket, room: Room, player: Player, event: string) {
    socket.data.roomId = room.code;
    player.connectionId = socket.id;
    void socket.join(room.code);
    socket.emit(event, { roomId: room.code, sessionId: player.sessionId, playerId: player.id, gameState: room.state });
    broadcast(room);
}

io.on('connection', (socket: Socket) => {
    function on(event: string, handler: (payload: Record<string, unknown>) => void | Promise<void>) {
        socket.on(event, (payload: unknown) => {
            if (takeRateLimit(messageBuckets, socket.data.account?.id || socket.id, MESSAGE_RATE)) { socket.emit('errorMsg', RATE_MESSAGE); return; }
            const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
            void Promise.resolve().then(async () => {
                if (!authDisabled(config) && (!socket.data.account || socket.data.account.expiresAt < Date.now())) { socket.emit('authExpired'); return; }
                await handler(data);
            }).catch(error => socket.emit('errorMsg', error instanceof Error ? error.message : 'Nachricht konnte nicht verarbeitet werden.'));
        });
    }
    socket.on('refreshAuth', (payload: { token: unknown }) => {
        if (takeRateLimit(messageBuckets, socket.data.account?.id || socket.id, MESSAGE_RATE)) { socket.emit('errorMsg', RATE_MESSAGE); return; }
        void verifyAccountToken(payload?.token, config).then(account => { if (account.id === socket.data.account?.id) socket.data.account = account; }).catch(() => socket.emit('authExpired'));
    });

    on('createRoom', async payload => {
        if (socket.data.roomId || socket.data.creatingRoom) throw new Error('Du bist bereits in einem Raum.');
        const name = socket.data.account?.name || sanitizeUsername(payload.username);
        if (!name) throw new Error('Bitte gib einen Spielernamen ein.');
        socket.data.creatingRoom = true;
        try {
            const capacity = await withBudget(() => budget.capacity());
            if (capacity.aiRoundLimit < 1) throw new Error('Kein kostenloses KI-Kontingent verfuegbar.');
            let code: string;
            do { code = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase(); } while (await roomExists(code) || rooms.has(code));
            if (!socket.connected) return;
            const player: Player = { id: socket.id, accountId: socket.data.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || randomUUID(), name, score: 0, connected: true };
            const room: Room = { code, hostId: player.id, players: [player], state: 'LOBBY',
                activeCreatorIndex: 0, currentVotes: {}, currentRound: 1, maxRounds: maxRounds(payload.maxRounds, capacity.aiRoundLimit),
                currentPrompt: '', currentVideoUrl: '', quota: capacity };
            rooms.set(code, room);
            enter(socket, room, player, 'roomCreated');
            persistMembers(room);
        } finally { socket.data.creatingRoom = false; }
    });

    on('joinRoom', async payload => {
        if (socket.data.roomId) throw new Error('Du bist bereits in einem Raum.');
        const room = rooms.get(sanitizeRoomId(payload.roomId));
        if (!room) throw new Error('Raum wurde nicht gefunden.');
        if (room.state !== 'LOBBY') throw new Error('Dieses Spiel wurde bereits gestartet.');
        const name = socket.data.account?.name || sanitizeUsername(payload.username);
        if (!name) throw new Error('Bitte gib einen Spielernamen ein.');
        if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('Dieser Spielername ist im Raum bereits vergeben.');
        if (socket.data.account && room.players.some(p => p.accountId === socket.data.account.id)) throw new Error('Dieses Konto ist bereits im Raum.');
        const player: Player = { id: socket.id, accountId: socket.data.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || randomUUID(), name, score: 0, connected: true };
        if (room.players.some(p => p.sessionId === player.sessionId)) throw new Error('Diese Sitzung ist bereits im Raum.');
        room.players.push(player);
        room.quota = undefined;
        enter(socket, room, player, 'joinedSuccess');
        await refreshLobbyQuota(room);
        persistMembers(room);
    });

    on('resumeRoom', async payload => {
        const room = rooms.get(sanitizeRoomId(payload.roomId));
        const player = room?.players.find(p => p.sessionId === sanitizeSessionId(payload.sessionId));
        if (!room || !player || (!authDisabled(config) && player.accountId !== socket.data.account?.id)) { socket.emit('resumeFailed'); return; }
        if (socket.data.roomId && socket.data.roomId !== room.code) throw new Error('Du bist bereits in einem Raum.');
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
        const { room, player } = member(socket, payload);
        void socket.leave(room.code);
        socket.data.roomId = undefined;
        leave(room, player);
        socket.emit('leftRoom');
    });

    on('refreshQuota', async payload => { const { room } = member(socket, payload); await refreshLobbyQuota(room); });
    on('setRoundCount', async payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'LOBBY' || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        await refreshLobbyQuota(room);
        if (room.state !== 'LOBBY' || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        if (!room.quota?.aiRoundLimit) throw new Error('Das KI-Kontingent reicht derzeit nicht fuer eine vollstaendige Runde mit allen Spielern.');
        room.maxRounds = maxRounds(payload.rounds, room.quota.aiRoundLimit);
        broadcast(room);
        persistMembers(room);
    });

    on('startGame', async payload => {
        const { room, player } = member(socket, payload);
        if (room.hostId !== player.id || room.state !== 'LOBBY') return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        if (pendingStarts.has(room.code)) return;
        pendingStarts.add(room.code);
        const roster = room.players.map(p => p.id).join(',');
        try {
            await refreshLobbyQuota(room);
            if (!room.maxRounds || roster !== room.players.map(p => p.id).join(',')) throw new Error('Das Kontingent oder die Spielerzahl hat sich geaendert. Bitte pruefe die Rundenauswahl.');
            await withBudget(() => budget.reserve(room.code, room.maxRounds, room.players.length));
            if (rooms.get(room.code) !== room || room.hostId !== player.id || room.state !== 'LOBBY' || roster !== room.players.map(p => p.id).join(',') || room.players.some(p => !p.connected)) { await withBudget(() => budget.release(room.code)); return; }
            startRounds(room);
            broadcast(room);
            persistMembers(room);
        }
        finally { pendingStarts.delete(room.code); }
    });

    on('sendImage', async payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'IDLE' || activeCreator(room)?.id !== player.id) return;
        const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim().slice(0, 150) : '';
        if (!prompt) throw new Error('Bitte gib einen Prompt ein.');
        validateImage(payload.imageBase64);
        const generationId = randomUUID();
        room.generationId = generationId;
        // Lock the turn before the quota request yields to another image submission.
        room.state = 'GENERATING';
        try { await withBudget(() => budget.begin(room.code, remainingVideos(room), generationId)); } catch (error) { if (room.generationId === generationId) room.state = 'IDLE'; throw error; }
        if (rooms.get(room.code) !== room || room.generationId !== generationId || activeCreator(room)?.id !== player.id) { await withBudget(() => budget.consume(room.code, generationId)); return; }
        room.state = 'GENERATING'; room.generationId = generationId;
        room.currentPrompt = prompt; room.currentVideoUrl = ''; room.currentVotes = {};
        broadcast(room);
        room.generationJob = undefined;
        runGeneration(room, generationId, payload.imageBase64 as string);
    });

    on('submitVote', payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'VOTING' || activeCreator(room)?.id === player.id || room.currentVotes[player.id] !== undefined) return;
        const points = Number(payload.points);
        if (!Number.isInteger(points) || points < 1 || points > 5) throw new Error('Bitte vergib 1 bis 5 Punkte.');
        room.currentVotes[player.id] = points;
        checkVotingComplete(room);
        broadcast(room);
    });

    on('startNextRound', payload => {
        const { room, player } = member(socket, payload);
        if (room.hostId !== player.id || room.state !== 'RESULTS') return;
        advanceTurn(room);
        broadcast(room);
    });

    on('extendGame', async payload => {
        const { room, player } = member(socket, payload);
        if (room.state !== 'GAME_OVER' || room.hostId !== player.id || pendingStarts.has(room.code)) return;
        if (Number(payload.completedVideo) !== (room.videoNumber || room.currentRound)) return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        pendingStarts.add(room.code);
        const roster = room.players.map(p => p.id).join(',');
        try {
            await refreshLobbyQuota(room);
            if (room.state !== 'GAME_OVER' || room.hostId !== player.id || roster !== room.players.map(p => p.id).join(',')) throw new Error('Die Spielerzahl hat sich geaendert. Bitte versuche es erneut.');
            await withBudget(() => budget.extend(room.code, room.players.length));
            if (rooms.get(room.code) !== room || room.state !== 'GAME_OVER' || room.hostId !== player.id || roster !== room.players.map(p => p.id).join(',') || room.players.some(p => !p.connected)) {
                await withBudget(() => budget.drop(room.code, roster.split(',').length));
                throw new Error('Die Spielerzahl oder Verbindung hat sich geaendert. Bitte versuche es erneut.');
            }
            extendRound(room);
            const snapshot = structuredClone(room);
            persist(room, () => reopenRoom(snapshot.code, snapshot.maxRounds, snapshot.hostId));
            broadcast(room);
        } finally { pendingStarts.delete(room.code); }
    });

    socket.on('disconnect', () => {
        const room = rooms.get(socket.data.roomId);
        const player = room && playerForConnection(room, socket.id);
        if (!room || !player) return;
        player.connected = false; player.disconnectedAt = Date.now();
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
ensureDatabaseSchema().then(() => server.listen(PORT, () => console.log(`Server laeuft auf http://127.0.0.1:${PORT}`)))
    .catch(error => { console.error('Datenbank konnte nicht initialisiert werden:', error instanceof Error ? error.message : 'Database error'); process.exitCode = 1; });
