import { authDisabled, requestAccount, verifyAccountToken, accountIsCurrent } from '../../auth/session';
import { HfRequiredError } from '../../auth/huggingface';
import { cloudflareAuth } from './profiles';
import { getDatabase } from '../../database/neon';
import { roundInput } from '../../game/persistence';
import { generateAiVideo, resumeAiVideo, AiPendingError, AiExpiredError, AI_RETRY_MS, AI_JOB_MAX_AGE_MS, validateImage } from '../../ai/generation';
import { qualityConfig } from '../../ai/providers';
import { preparedImageSize } from '../../ai/images';
import { gameOptions } from '../../game/options';
import { archiveCapacity, isArchiveGame, prepareArchive, playArchiveVideo, checkArchiveContent, needsContentCheck } from '../../game/archive-play';
import { closePhase, syncPhase } from '../../game/phases';
import { writeSharedImage, readSharedImage, deleteSharedImage, sharedImageResponse } from '../../game/images';
import { logAiEvent } from '../../ai/telemetry';
import { archiveEnabled } from '../../storage/archive';
import { takeRateLimit, rateKey, MESSAGE_RATE, MESSAGE_BYTES, expensiveMessageRule, RATE_MESSAGE, type RateBuckets } from '../../security/rate-limit';
import { type QuotaCapacity } from '../../ai/quota';
import { roomAccountIds, type Room as RoomState, type Player, activeCreator, roomSnapshot, finalStandings, removePlayer, finishVoting, sanitizeUsername, sanitizeRoomId, sanitizeSessionId, maxRounds, DISCONNECT_GRACE_MS, startRounds, advanceTurn, remainingVideos, remainingVideosFor, extendRound, recordVote, judgeGuesses, beginViewing, confirmPreview } from '../../game/rules';
import { service } from './runtime';
import { deleteStoredHistory, historyVideo, HistoryError, historyJson, type HistoryDeletion } from '../statistics';
import type { DurableObjectState, CloudflareWebSocket, ConnectionMeta, Env, PendingRoomWrite } from './types';
import { participants, participantForConnection, isSpectator, resetReady, startProblem, checkJoin, prepareRematch } from '../../game/participants';
import { normalizeImage } from '../../security/images';
import { generationSafetyReady, moderateInput, validatePrompt } from '../../security/moderation';
import { buildVideoPrompt } from '../../ai/generation';
import { archiveRecovery } from '../../ai/recovery';
import { ARCHIVE_LEASE_MS } from '../../storage/reservations';
import { operationFailure } from '../../security/diagnostics';
import { releaseId } from '../../security/release';
import type { GenerationStage } from '../../shared/generation';
import { generationView } from '../../game/rules';
import { approvedProvider } from '../../ai/provider-trust';

declare class WebSocketPair { 0: CloudflareWebSocket; 1: CloudflareWebSocket }

export class RoomDurableObject {
    private room: RoomState | null = null;
    private roomCode = '';
    private readonly sockets = new Map<CloudflareWebSocket, ConnectionMeta>();
    private operations: Promise<unknown> = Promise.resolve();
    private pendingRounds: PendingRoomWrite[] = [];
    private activeGenerations = new Set<string>();
    private quotaReleases: { code: string; jobId: string }[] = [];
    private aiJobs: Record<string, { code: string; job: NonNullable<RoomState['generationJob']>; retryAt?: number }> = {};
    private messageBuckets: RateBuckets = {};
    private snapshotChecks = new Set<CloudflareWebSocket>();
    private archiveLeaseRenewAt = 0;
    private leasedVideoUrl = '';
    private contentCheckAt = 0;

    constructor(private state: DurableObjectState, private env: Env) {
        state.blockConcurrencyWhile(async () => {
            this.room = (await state.storage.get<RoomState>('room')) || null;
            this.pendingRounds = (await state.storage.get<PendingRoomWrite[]>('pendingRounds')) || [];
            this.quotaReleases = (await state.storage.get<typeof this.quotaReleases>('quotaReleases')) || [];
            this.aiJobs = (await state.storage.get<typeof this.aiJobs>('aiJobs')) || {};
            for (const socket of state.getWebSockets()) this.sockets.set(socket, socket.deserializeAttachment());
            if (this.room) {
                this.roomCode = this.room.code;
                for (const player of participants(this.room)) {
                    const connection = [...this.sockets.values()].find(meta => meta.playerId === player.id);
                    player.connected = Boolean(connection);
                    if (connection) player.connectionId = connection.socketId;
                    else { player.disconnectedAt ??= Date.now(); player.ready = false; }
                }
                if (this.room.state === 'GENERATING') {
                    this.room.generationJob ||= this.aiJobs[this.room.generationId || '']?.job;
                    if (this.room.generationJob && this.room.generationId) this.room.generationRetryAt = Date.now() + 100;
                    else { this.room.state = 'IDLE'; this.room.generationId = undefined; }
                }
                await this.saveRoom();
            }
            // The constructor also runs before a scheduled alarm wakes this object.
            if (await state.storage.getAlarm() === null) await this.scheduleAlarm();
        });
    }

    private enqueue<T>(action: () => Promise<T>) {
        const next = this.operations.then(action);
        this.operations = next.catch(error => {
            operationFailure('room-operation', error);
        });
        return next;
    }

    async fetch(request: Request): Promise<Response> {
        if (request.url === 'https://internal/video/access' && request.method === 'POST') {
            const { accountId, url } = await request.json() as { accountId?: string; url?: string };
            return new Response(null, { status: this.room && accountId && participants(this.room).some(p => p.accountId === accountId)
                && this.room.currentVideoUrl === url ? 200 : 403 });
        }
        if (request.url === 'https://internal/rematch' && request.method === 'POST') return this.enqueue(async () => {
            const { requestId, room } = await request.json() as { requestId: string; room: RoomState };
            if (this.room?.rematchSource === requestId) return historyJson({ ok: true });
            if (this.room || await getDatabase(this.env.DATABASE_URL)?.roomExists(room.code)) return historyJson({ error: 'Raumcode belegt.' }, 409);
            if (!sanitizeRoomId(room.code) || !requestId || room.state !== 'LOBBY') return historyJson({}, 400);
            room.quota = isArchiveGame(room) ? archiveCapacity(await this.playableArchive(room), room.players.length)
                : await service(this.env, '/quota/capacity', { players: room.players.length, quality: gameOptions(room.options).quality, participants: room.players }) as QuotaCapacity;
            room.maxRounds = room.quota.aiRoundLimit ? maxRounds(room.maxRounds || 1, room.quota.aiRoundLimit) : 0;
            this.room = room; this.roomCode = room.code;
            // The initialization identity and room must survive together, including ambiguous responses.
            room.rematchSource = requestId;
            await this.saveRoom(); await this.scheduleAlarm();
            return historyJson({ ok: true });
        });
        if (/^\/api\/rooms\/[A-Z0-9]{4}\/image$/.test(new URL(request.url).pathname)) {
            try {
                const account = await requestAccount(request, cloudflareAuth(this.env));
                if (!this.room || (!authDisabled(this.env) && !participants(this.room).some(player => player.accountId === account?.id))) return new Response(null, { status: 403 });
                return sharedImageResponse(request, this.state.storage, this.room.sharedImage);
            } catch { return new Response(null, { status: 401 }); }
        }
        if (request.url === 'https://internal/statistics/delete' && request.method === 'POST') {
            return this.enqueue(async () => {
                const command = await request.json() as HistoryDeletion;
                if (!sanitizeRoomId(command.code) || (this.room && this.room.code !== command.code)) throw new HistoryError('Ungültiger Raum.', 400);
                const database = getDatabase(this.env.DATABASE_URL);
                const video = await historyVideo(database, command);
                const needsRoom = !video?.roomDeleted && !command.restore;
                if (needsRoom) {
                    if ((this.room && this.room.state !== 'GAME_OVER') || this.activeGenerations.size || Object.keys(this.aiJobs).length) throw new HistoryError('Der Raum wird noch gespielt. Beende die Partie zuerst.', 409);
                    await this.flushPendingRounds();
                    if (this.pendingRounds.length) throw new HistoryError('Die Partie wird noch gespeichert. Bitte versuche es gleich erneut.');
                }
                const result = video && !command.restore
                    ? await service(this.env, '/video-trash/delete', { command })
                    : await deleteStoredHistory(database, command, time => service(this.env, '/video-trash/schedule', { time }).then(() => {}));
                if (!command.roundNumber && !command.videoId) {
                    this.room = null;
                    await this.saveRoom();
                    for (const socket of this.sockets.keys()) { this.send(socket, 'leftRoom'); socket.close(1000, 'Room deleted'); }
                    this.sockets.clear();
                } else if (!video?.roomDeleted && !command.restore && this.room && (this.room.videoNumber || this.room.currentRound) === command.roundNumber) {
                    this.room.currentVideoUrl = '';
                    await this.saveRoom();
                }
                return historyJson({ ok: true, ...result });
            }).catch(error => historyJson({ error: (error as Error).message }, error instanceof HistoryError ? error.status : 503));
        }
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket upgrade', { status: 426 });
        this.roomCode = sanitizeRoomId(new URL(request.url).pathname.replace('/ws/', ''));
        const pair = new WebSocketPair();
        const socketId = crypto.randomUUID();
        const meta: ConnectionMeta = { socketId, acceptedAt: Date.now(), account: await requestAccount(request, cloudflareAuth(this.env)) };
        this.state.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment(meta);
        this.sockets.set(pair[1], meta);
        this.send(pair[1], 'connect', { socketId });
        await this.scheduleAlarm();
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: CloudflareWebSocket });
    }

    async webSocketMessage(socket: CloudflareWebSocket, data: string | ArrayBuffer) {
        await this.enqueue(async () => {
            try {
                if (typeof data !== 'string' || data.length > 12 * 1024 * 1024) throw new Error('Ungültige Nachricht oder Bild zu groß.');
                const meta = this.sockets.get(socket);
                if (!meta) return;
                const bytes = new TextEncoder().encode(data).length;
                if (bytes > 12 * 1024 * 1024) throw new Error('Die Nachricht ist zu groß.');
                const actor = meta.account?.id || meta.playerId || meta.socketId;
                if (takeRateLimit(this.messageBuckets, actor, MESSAGE_RATE) || takeRateLimit(this.messageBuckets, `bytes:${actor}`, MESSAGE_BYTES, Date.now(), bytes)) throw new Error(RATE_MESSAGE);
                const message = JSON.parse(data) as { type?: string; payload?: Record<string, unknown> };
                if (!message || typeof message.type !== 'string' || (message.payload && (typeof message.payload !== 'object' || Array.isArray(message.payload)))) throw new Error('Ungültige Nachricht.');
                const payload = message.payload || {};
                const rule = expensiveMessageRule(message.type);
                if (rule) {
                    const key = await rateKey(actor, `command:${message.type}`, this.env.AUTH_COOKIE_SECRET);
                    if ((await service(this.env, '/security/rate', { key, rule })).retryAfter) throw new Error(RATE_MESSAGE);
                }
                if (message.type === 'refreshAuth') {
                    const account = await verifyAccountToken(payload.token, cloudflareAuth(this.env));
                    if (meta.account?.id !== account.id) throw new Error('Bitte verbinde dich erneut.');
                    meta.account = { ...account, hfConnectionId: meta.account?.hfConnectionId }; socket.serializeAttachment(meta); return;
                }
                if (!authDisabled(this.env) && (!meta.account || meta.account.expiresAt < Date.now())) { this.send(socket, 'authExpired'); return; }
                if (!authDisabled(this.env) && !await accountIsCurrent(meta.account!, cloudflareAuth(this.env))) {
                    this.send(socket, 'authExpired');
                    const player = this.room && participantForConnection(this.room, meta.socketId);
                    if (player) await this.leaveRoom(socket, player); else socket.close(4003, 'Account deleted');
                    return;
                }
                if (message.type === 'createRoom') await this.createRoom(socket, meta, payload);
                else if (message.type === 'joinRoom') await this.joinRoom(socket, meta, payload);
                else if (message.type === 'resumeRoom') await this.resumeRoom(socket, meta, payload);
                else {
                    const player = this.room && participantForConnection(this.room, meta.socketId);
                    if (!player || meta.playerId !== player.id) throw new Error('Bitte verbinde dich zuerst mit dem Raum.');
                    if (message.type === 'leaveRoom') await this.leaveRoom(socket, player);
                    else if (isSpectator(this.room!, player)) throw new Error('Als Zuschauer kannst du diese Aktion nicht ausführen.');
                    else if (message.type === 'setReady' && this.room!.state === 'LOBBY' && typeof payload.ready === 'boolean') { player.ready = payload.ready; await this.saveRoom(); this.broadcastRoomUpdate(); }
                    else if (message.type === 'refreshQuota') await this.refreshLobbyQuota();
                    else if (message.type === 'setRoundCount') await this.setRoundCount(player, payload);
                    else if (message.type === 'setGameOptions') await this.setGameOptions(player, payload);
                    else if (message.type === 'setSharedImage') await this.setSharedImage(player, payload);
                    else if (message.type === 'startGame') await this.startGame(player);
                    else if (message.type === 'sendImage') await this.sendImage(player, payload);
                    else if (message.type === 'submitVote') await this.submitVote(player, payload);
                    else if (message.type === 'judgeGuesses') {
                        if (await this.archiveContentReady(this.room!) && judgeGuesses(this.room!, player, payload)) await this.checkVotingComplete();
                    }
                    else if (message.type === 'finishPreview' && confirmPreview(this.room!, player, payload)) { await this.checkVotingComplete(true); this.broadcastRoomUpdate(); }
                    else if (message.type === 'startNextRound') await this.startNextRound(player);
                    else if (message.type === 'closePhase' && this.room!.hostId === player.id && payload.phaseKey === this.room!.phaseKey) await this.endPhase();
                    else if (message.type === 'extendGame') await this.extendGame(player, payload);
                    else if (message.type === 'rematchGame') await this.rematchGame(player);
                }
            } catch (error) {
                this.send(socket, error instanceof HfRequiredError ? 'hfRequired' : 'errorMsg', error instanceof Error ? error.message : 'Nachricht konnte nicht verarbeitet werden.');
            }
        });
    }

    async webSocketClose(socket: CloudflareWebSocket) { await this.enqueue(() => this.disconnect(socket)); }
    async webSocketError(socket: CloudflareWebSocket) { await this.enqueue(() => this.disconnect(socket)); }

    private bind(socket: CloudflareWebSocket, meta: ConnectionMeta, player: Player) {
        meta.playerId = player.id;
        meta.sessionId = player.sessionId;
        player.connectionId = meta.socketId;
        player.hfConnectionId = this.room && isSpectator(this.room, player) ? undefined : meta.account?.hfConnectionId;
        socket.serializeAttachment(meta);
    }

    private async createRoom(socket: CloudflareWebSocket, meta: ConnectionMeta, payload: Record<string, unknown>) {
        if (meta.playerId) throw new Error('Du bist bereits in einem Raum.');
        const username = meta.account?.name || sanitizeUsername(payload.username);
        if (!username) throw new Error('Bitte gib einen Spielernamen ein.');
        await service(this.env, '/hf/require', { account: meta.account });
        const database = getDatabase(this.env.DATABASE_URL);
        if (this.room || await database?.roomExists(this.roomCode)) {
            this.send(socket, 'roomCodeConflict');
            return;
        }
        const player: Player = { id: meta.socketId, accountId: meta.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || crypto.randomUUID(), name: username, score: 0, connected: true };
        player.hfConnectionId = meta.account?.hfConnectionId;
        const capacity = await service(this.env, '/quota/capacity', { players: 1, participants: [player] });
        this.room = {
            code: this.roomCode, hostId: player.id, players: [player], state: 'LOBBY',
            activeCreatorIndex: 0, currentVotes: {}, currentRound: 1,
            maxRounds: capacity.aiRoundLimit ? maxRounds(payload.maxRounds, capacity.aiRoundLimit) : 0, currentPrompt: '', currentVideoUrl: '', quota: capacity as QuotaCapacity,
            options: gameOptions(), imageProfile: 'bounded'
        };
        this.bind(socket, meta, player);
        await this.saveRoom();
        this.send(socket, 'roomCreated', { roomId: this.roomCode, sessionId: player.sessionId, playerId: player.id });
        this.broadcastRoomUpdate();
        await this.persistMembers();
    }

    private async joinRoom(socket: CloudflareWebSocket, meta: ConnectionMeta, payload: Record<string, unknown>) {
        const room = this.room;
        if (meta.playerId) throw new Error('Du bist bereits in diesem Raum.');
        if (!room) throw new Error('Raum wurde nicht gefunden.');
        const spectator = payload.role === 'spectator';
        if (room.rematch?.initialized) throw new Error('Bitte verwende den neuen Raumcode.');
        const name = meta.account?.name || sanitizeUsername(payload.username);
        if (!name) throw new Error('Bitte gib einen Spielernamen ein.');
        checkJoin(room, name, meta.account?.id, spectator);
        if (!spectator) await service(this.env, '/hf/require', { account: meta.account });
        const player: Player = { id: meta.socketId, accountId: meta.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || crypto.randomUUID(), name, score: 0, connected: true };
        if (!spectator) await service(this.env, '/hf/roster', { participants: [...room.players, { ...player, hfConnectionId: meta.account?.hfConnectionId }] });
        if (participants(room).some(p => p.sessionId === player.sessionId)) throw new Error('Diese Sitzung ist bereits im Raum.');
        if (spectator) (room.spectators ??= []).push(player);
        else { room.players.push(player); resetReady(room); }
        this.bind(socket, meta, player);
        await this.saveRoom();
        this.send(socket, 'joinedSuccess', { roomId: room.code, sessionId: player.sessionId, playerId: player.id });
        if (!spectator) await this.refreshLobbyQuota();
        this.broadcastRoomUpdate();
        if (!spectator) await this.persistMembers();
    }

    private async resumeRoom(socket: CloudflareWebSocket, meta: ConnectionMeta, payload: Record<string, unknown>) {
        const room = this.room;
        const player = room && participants(room).find(p => p.sessionId === sanitizeSessionId(payload.sessionId));
        if (!room || !player || (!authDisabled(this.env) && player.accountId !== meta.account?.id)) { this.send(socket, 'resumeFailed'); return; }
        if (room.rematch?.initialized && room.rematch.transfers[player.id]) { this.send(socket, 'roomTransfer', room.rematch.transfers[player.id]); return; }
        if (!isSpectator(room, player)) await service(this.env, '/hf/require', { account: meta.account });
        for (const [old, connection] of this.sockets) {
            if (old !== socket && connection.playerId === player.id) {
                this.sockets.delete(old);
                old.close(4001, 'Session resumed elsewhere');
            }
        }
        player.connected = true;
        player.disconnectedAt = undefined;
        this.bind(socket, meta, player);
        await this.saveRoom();
        this.send(socket, 'resumeSuccess', { roomId: room.code, sessionId: player.sessionId, playerId: player.id, gameState: room.state });
        await this.refreshLobbyQuota();
        this.broadcastRoomUpdate();
        await this.scheduleAlarm();
    }

    private async leaveRoom(socket: CloudflareWebSocket, player: Player) {
        if (!this.room) return;
        const room = this.room;
        const wasOver = room.state === 'GAME_OVER';
        const viewer = isSpectator(room, player);
        const skipped = viewer ? 0 : removePlayer(room, player.id);
        if (viewer) room.spectators = room.spectators?.filter(p => p.id !== player.id);
        if (room.players.length) playArchiveVideo(room);
        if (skipped) await service(this.env, '/quota/drop', { code: room.code, generations: skipped, playerId: player.id });
        this.sockets.delete(socket);
        if (!this.room.players.length) { this.ejectSpectators(room); await service(this.env, '/quota/release', { code: this.roomCode }); this.room = null; }
        await this.saveRoom();
        this.send(socket, 'leftRoom');
        socket.close(1000, 'Left room');
        this.broadcast('roomNotice', `${player.name} hat das Spiel verlassen.`);
        if (this.room && !wasOver && room.state === 'GAME_OVER') await this.queueFinal();
        await this.checkVotingComplete();
        if (!viewer) await this.refreshLobbyQuota();
        this.broadcastRoomUpdate();
        await this.scheduleAlarm();
    }

    private async startGame(player: Player) {
        const room = this.room!;
        if (room.state !== 'LOBBY' || room.hostId !== player.id) return;
        if (startProblem(room)) throw new Error(startProblem(room));
        await service(this.env, '/hf/roster', { participants: room.players });
        if (gameOptions(room.options).sharedImage) await readSharedImage(this.state.storage, room.sharedImage);
        await this.refreshLobbyQuota();
        if (!room.maxRounds) throw new Error('Das KI-Kontingent reicht derzeit nicht für eine vollständige Runde mit allen Spielern.');
        if (isArchiveGame(room)) prepareArchive(room, await this.playableArchive(room));
        else await service(this.env, '/quota/reserve', { code: room.code, rounds: room.maxRounds, players: room.players.length, quality: gameOptions(room.options).quality, participants: room.players });
        const disconnected = room.players.some(p => ![...this.sockets].some(([socket, meta]) => meta.playerId === p.id && socket.readyState === 1));
        if (startProblem(room) || disconnected) { await service(this.env, '/quota/release', { code: room.code }); throw new Error(startProblem(room) || 'Warte, bis alle Spieler verbunden sind.'); }
        startRounds(room);
        playArchiveVideo(room);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.persistMembers();
    }

    private async refreshLobbyQuota() {
        const room = this.room;
        if (!room || (room.state !== 'LOBBY' && room.state !== 'GAME_OVER')) return;
        const capacity = isArchiveGame(room) ? archiveCapacity(await this.playableArchive(room), room.players.length)
            : await service(this.env, '/quota/capacity', { players: room.players.length, quality: gameOptions(room.options).quality, participants: room.players }) as QuotaCapacity;
        if (room.state === 'GAME_OVER') room.extensionQuota = capacity;
        else {
            room.quota = capacity;
            const rounds = capacity.aiRoundLimit ? maxRounds(room.maxRounds || 1, capacity.aiRoundLimit) : 0;
            if (rounds !== room.maxRounds) resetReady(room);
            room.maxRounds = rounds;
        }
        await this.saveRoom();
        this.broadcastRoomUpdate();
    }

    private async setRoundCount(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (room.state !== 'LOBBY' || room.hostId !== player.id) return;
        await this.refreshLobbyQuota();
        if (!room.quota?.aiRoundLimit) throw new Error('Das KI-Kontingent reicht derzeit nicht für eine vollständige Runde mit allen Spielern.');
        room.maxRounds = maxRounds(payload.rounds, room.quota.aiRoundLimit); resetReady(room);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.persistMembers();
    }

    private async setGameOptions(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (room.state !== 'LOBBY' || room.hostId !== player.id) return;
        room.options = gameOptions(payload.options); resetReady(room);
        await this.refreshLobbyQuota(); await this.persistMembers();
    }

    private async setSharedImage(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        const recovering = room.state === 'IDLE' && gameOptions(room.options).sharedImage && (!room.sharedImage || room.sharedImage.expiresAt <= Date.now());
        if ((!['LOBBY', 'GAME_OVER'].includes(room.state) && !recovering) || room.hostId !== player.id) return;
        const image = await writeSharedImage(this.state.storage, payload.imageBase64, this.env), old = room.sharedImage;
        room.sharedImage = image; resetReady(room);
        try { await this.saveRoom(); }
        catch (error) { room.sharedImage = old; await deleteSharedImage(this.state.storage, image); throw error; }
        await deleteSharedImage(this.state.storage, old);
        this.broadcastRoomUpdate(); await this.scheduleAlarm();
    }

    private async sendImage(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (isArchiveGame(room) || room.state !== 'IDLE' || activeCreator(room)?.id !== player.id) return;
        const prompt = validatePrompt(payload.prompt);
        generationSafetyReady(this.env);
        if (this.env.AI_PROVIDER !== 'mock') approvedProvider(this.env);
        const imageBase64 = await normalizeImage(gameOptions(room.options).sharedImage ? await readSharedImage(this.state.storage, room.sharedImage) : payload.imageBase64);
        await moderateInput(imageBase64, buildVideoPrompt(prompt), this.env);
        const image = validateImage(imageBase64);
        if (room.imageProfile === 'bounded') preparedImageSize(image.base64);
        if (this.env.AI_PROVIDER !== 'mock' && !archiveEnabled(this.env)) throw new Error('Der Videospeicher ist nicht eingerichtet. Bitte die Storage-Schlüssel auf dem Server hinterlegen.');
        const generationId = crypto.randomUUID();
        if (this.env.AI_PROVIDER !== 'mock') await service(this.env, '/archive/preflight', { code: room.code, jobId: generationId });
        try {
            await service(this.env, '/quota/begin', { code: room.code, generations: remainingVideos(room), jobId: generationId,
                playerId: player.id, ownRemaining: remainingVideosFor(room, player.id), participant: player });
        } catch (error) { await service(this.env, '/archive/release', { jobId: generationId }).catch(() => {}); throw error; }
        room.state = 'GENERATING';
        room.generationId = generationId;
        room.generationStartedAt = Date.now(); room.generationStage = 'preparing';
        room.currentPrompt = prompt;
        room.currentVideoUrl = '';
        room.currentVotes = {};
        room.generationJob = undefined;
        await this.saveRoom();
        this.broadcastRoomUpdate();
        this.runGeneration(room, imageBase64 as string);
    }

    private runGeneration(room: RoomState, image?: string) {
        const generationId = room.generationId!;
        if (this.activeGenerations.has(generationId)) return;
        this.activeGenerations.add(generationId);
        room.generationRetryAt = undefined;
        const progress = (step: string, stage: GenerationStage = 'result') => {
            this.state.waitUntil(this.enqueue(async () => {
                if (this.room !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
                room.generationStage = stage; await this.saveRoom();
                this.broadcast('generationProgress', { step, roomId: room.code, generation: generationView(room), serverTime: Date.now() });
            }).catch(error => operationFailure('room-operation', error)));
        };
        const lifecycle = {
            context: { generationId, roomCode: room.code, videoNumber: room.videoNumber || room.currentRound, releaseId: releaseId(this.env.CF_VERSION_METADATA?.id) },
            saveJob: async (job: NonNullable<RoomState['generationJob']>) => this.enqueue(async () => {
                this.aiJobs[generationId] = { code: room.code, job };
                await this.state.storage.put('aiJobs', this.aiJobs);
                if (this.room !== room || room.generationId !== generationId) return;
                room.generationJob = job;
                await this.saveRoom();
            })
        };
        const generation = room.generationJob?.status === 'complete' && room.generationJob.videoUrl ? Promise.resolve(room.generationJob.videoUrl)
            : this.generationConfig(room.code, generationId, room.generationJob).then(config => image
            ? generateAiVideo(image, room.currentPrompt, qualityConfig(config, gameOptions(room.options).quality), progress,
                seconds => service(this.env, '/quota/attempt', { code: room.code, seconds, jobId: generationId }).then(() => {}), lifecycle)
            : resumeAiVideo(room.generationJob!, config, progress, lifecycle));
        const work = generation
        .then(async videoUrl => {
            if (this.room !== room || room.generationId !== generationId) return videoUrl;
            if (this.env.AI_PROVIDER === 'mock' && videoUrl === '/assets/mock-video.mp4') return videoUrl;
            progress('Video wird geprüft und gespeichert …', 'archive');
            try { return (await service(this.env, '/archive', { url: videoUrl, code: room.code, artifact: room.generationJob ? { generationId, submittedAt: room.generationJob.submittedAt, releaseId: releaseId(this.env.CF_VERSION_METADATA?.id) } : undefined })).url as string; }
            catch (error) { throw archiveRecovery(error, room.generationJob); }
        }).then(videoUrl => this.enqueue(async () => {
            await this.releaseGenerationQuota(room.code, generationId);
            if (this.room !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
            room.currentVideoUrl = videoUrl;
            room.state = 'VOTING';
            beginViewing(room);
            await this.saveRoom();
            this.broadcastRoomUpdate();
            await this.scheduleAlarm();
        }), error => this.enqueue(async () => {
            if (!(error instanceof AiPendingError) && !(error instanceof AiExpiredError)) await this.releaseGenerationQuota(room.code, generationId);
            if (error instanceof AiExpiredError) {
                delete this.aiJobs[generationId];
                await this.state.storage.put('aiJobs', this.aiJobs);
            }
            if (error instanceof AiPendingError) {
                this.aiJobs[generationId] = { code: room.code, job: error.job, retryAt: Date.now() + AI_RETRY_MS };
                await this.state.storage.put('aiJobs', this.aiJobs);
            }
            if (this.room !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
            if (error instanceof AiPendingError) {
                room.generationJob = error.job;
                room.generationRetryAt = Date.now() + AI_RETRY_MS;
                room.generationStage = error.job.status === 'complete' ? 'archive' : 'retry';
                await this.saveRoom();
                this.broadcastRoomUpdate();
                return;
            }
            room.state = 'IDLE';
            room.generationId = undefined;
            room.generationJob = undefined;
            await this.saveRoom();
            this.broadcastRoomUpdate();
            this.broadcast('errorMsg', error instanceof Error ? error.message : 'Generierung fehlgeschlagen.');
        }));
        this.state.waitUntil(work.finally(() => this.enqueue(async () => {
            this.activeGenerations.delete(generationId);
            await this.refreshLobbyQuota();
            await this.scheduleAlarm();
        })).catch(() => logAiEvent('callback_failed', { ...lifecycle.context, errorCode: 'storage_or_service' })));
    }

    private async releaseGenerationQuota(code: string, jobId: string) {
        if (!this.quotaReleases.some(job => job.jobId === jobId)) this.quotaReleases.push({ code, jobId });
        await this.state.storage.put('quotaReleases', this.quotaReleases);
        delete this.aiJobs[jobId];
        await this.state.storage.put('aiJobs', this.aiJobs);
        await this.flushQuotaReleases();
    }

    private async generationConfig(code: string, jobId: string, job?: RoomState['generationJob']) {
        if (job?.status === 'complete' && job.videoUrl) return this.env;
        try { return { ...this.env, HF_TOKEN: (await service(this.env, '/quota/token', { code, jobId })).token as string | undefined }; }
        catch (error) {
            if (job) {
                if (Date.now() - job.submittedAt >= AI_JOB_MAX_AGE_MS) throw new AiExpiredError();
                throw new AiPendingError(job);
            }
            throw error;
        }
    }

    private resumeAbandonedJob(jobId: string) {
        const entry = this.aiJobs[jobId];
        if (!entry || this.activeGenerations.has(jobId)) return;
        this.activeGenerations.add(jobId);
        const context = { generationId: jobId, roomCode: entry.code };
        const work = this.generationConfig(entry.code, jobId, entry.job).then(config => resumeAiVideo(entry.job, config, undefined, { context })).then(
            () => this.enqueue(() => this.releaseGenerationQuota(entry.code, jobId)),
            error => this.enqueue(async () => {
                if (error instanceof AiPendingError) {
                    entry.retryAt = Date.now() + AI_RETRY_MS;
                    await this.state.storage.put('aiJobs', this.aiJobs);
                } else if (error instanceof AiExpiredError) {
                    // Unknown remote work keeps its conservative quota hold until its TTL.
                    delete this.aiJobs[jobId];
                    await this.state.storage.put('aiJobs', this.aiJobs);
                } else await this.releaseGenerationQuota(entry.code, jobId);
            })
        );
        this.state.waitUntil(work.finally(() => this.enqueue(async () => {
            this.activeGenerations.delete(jobId);
            await this.scheduleAlarm();
        })).catch(() => logAiEvent('callback_failed', { ...context, errorCode: 'storage_or_service' })));
    }

    private async flushQuotaReleases() {
        while (this.quotaReleases.length) {
            try {
                await service(this.env, '/quota/consume', this.quotaReleases[0]);
                await service(this.env, '/archive/release', this.quotaReleases[0]);
            }
            catch { break; }
            this.quotaReleases.shift();
            await this.state.storage.put('quotaReleases', this.quotaReleases);
        }
    }

    private async submitVote(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (room.state !== 'VOTING') return;
        if (room.currentVotes[player.id] !== undefined) return;
        recordVote(room, player, payload);
        await this.saveRoom();
        await this.checkVotingComplete();
        this.broadcastRoomUpdate();
    }

    private async startNextRound(player: Player) {
        const room = this.room!;
        if (room.state !== 'RESULTS' || room.hostId !== player.id) return;
        advanceTurn(room);
        playArchiveVideo(room);
        await this.saveRoom();
        this.broadcastRoomUpdate();
    }

    private async extendGame(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (isArchiveGame(room)) throw new Error('Starte für weitere Archivvideos eine neue Partie.');
        if (room.state !== 'GAME_OVER' || room.hostId !== player.id) return;
        if (Number(payload.completedVideo) !== (room.videoNumber || room.currentRound)) return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        if (gameOptions(room.options).sharedImage) await readSharedImage(this.state.storage, room.sharedImage);
        await this.refreshLobbyQuota();
        await service(this.env, '/quota/extend', { code: room.code, players: room.players.length, quality: gameOptions(room.options).quality, participants: room.players });
        extendRound(room);
        this.pendingRounds.push({ ...structuredClone(room), writeAction: 'continue' });
        await this.state.storage.put('pendingRounds', this.pendingRounds);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.flushPendingRounds();
    }

    private async checkVotingComplete(confirmedSolo = false) {
        const room = this.room;
        if (!room) return;
        if (!await this.archiveContentReady(room)) return;
        if (!finishVoting(room, confirmedSolo)) { await this.saveRoom(); return; }
        await this.completeVoting();
    }

    private async archiveContentReady(room: RoomState) {
        this.contentCheckAt = Date.now() + 10_000;
        try {
            const result = await checkArchiveContent(room, async url => {
                if (!this.env.SERVICES && this.env.AI_PROVIDER === 'mock') return false;
                const response = await service(this.env, '/security/content/blocked', { url });
                if (typeof response.blocked !== 'boolean') throw new Error('Content status unavailable');
                return response.blocked;
            });
            if (result === 'skipped') {
                await this.saveRoom(); this.broadcastRoomUpdate();
                this.broadcast('roomNotice', 'Ein gesperrtes Video wurde ohne Wertung übersprungen.');
                if (!isArchiveGame(room) && room.state === 'GAME_OVER') await this.queueFinal();
            }
            return result === 'allowed';
        } catch (error) {
            operationFailure('archive-content-status', error);
            this.broadcast('roomNotice', 'Die Inhaltsprüfung ist gerade nicht erreichbar. Die Wertung wartet.');
            return false;
        }
    }

    private async completeVoting() {
        const room = this.room!;
        if (room.state === 'GAME_OVER') await service(this.env, '/quota/release', { code: room.code });
        if (!isArchiveGame(room)) this.pendingRounds.push(structuredClone(room));
        await this.state.storage.put('pendingRounds', this.pendingRounds);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.flushPendingRounds();
        await this.refreshLobbyQuota();
    }

    private async queueFinal() {
        if (!this.room) return;
        await service(this.env, '/quota/release', { code: this.room.code });
        if (!isArchiveGame(this.room)) this.pendingRounds.push(structuredClone(this.room));
        await this.state.storage.put('pendingRounds', this.pendingRounds);
        await this.flushPendingRounds();
        await this.refreshLobbyQuota();
    }

    private async persistMembers() {
        const room = this.room;
        if (!room || isArchiveGame(room) || room.state === 'LOBBY') return;
        try {
            const database = getDatabase(this.env.DATABASE_URL);
            await database?.saveRoom(room.code, room.hostId, room.maxRounds);
            await database?.saveScores(room.code, room.players, room.hostId);
            await database?.markRoomStarted(room.code);
        } catch (error) {
            operationFailure('members', error);
            this.broadcast('roomNotice', 'Die Statistik-Speicherung ist momentan nicht erreichbar.');
        }
    }

    private async flushPendingRounds() {
        if (!this.env.DATABASE_URL) { this.pendingRounds = []; await this.state.storage.delete('pendingRounds'); return; }
        while (this.pendingRounds.length) {
            const room = this.pendingRounds[0];
            try {
                const database = getDatabase(this.env.DATABASE_URL)!;
                await database.saveRoom(room.code, room.hostId, room.maxRounds);
                await database.markRoomStarted(room.code);
                if (room.writeAction === 'continue') await database.reopenRoom(room.code, room.maxRounds, room.hostId);
                else if (room.state === 'GAME_OVER' && !room.lastResult) await database.markRoomFinished(room.code, finalStandings(room));
                else await database.saveRound(roundInput(room));
                this.pendingRounds.shift();
                await this.state.storage.put('pendingRounds', this.pendingRounds);
            } catch (error) {
                operationFailure('round', error);
                this.broadcast('roomNotice', 'Statistiken werden gespeichert, sobald die Datenbank wieder erreichbar ist.');
                break;
            }
        }
        await this.scheduleAlarm();
    }

    private async rematchGame(player: Player) {
        const room = this.room!;
        if (room.state !== 'GAME_OVER' || room.hostId !== player.id) return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        await this.flushPendingRounds();
        if (this.pendingRounds.length) throw new Error('Die Partie wird noch gespeichert. Bitte versuche es gleich erneut.');
        for (let attempt = 0; attempt < 8; attempt++) {
            if (!room.rematch) {
                const code = crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
                if (code === room.code) continue;
                room.rematch = prepareRematch(room, code);
                await this.saveRoom();
            }
            const plan = room.rematch;
            if (!plan.initialized) {
                const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(plan.room.code)).fetch(new Request('https://internal/rematch', { method: 'POST', body: JSON.stringify({ requestId: plan.requestId, room: plan.room }) }));
                if (response.status === 409) { room.rematch = undefined; await this.saveRoom(); continue; }
                if (!response.ok) throw new Error('Die Revanche konnte noch nicht vorbereitet werden. Bitte erneut versuchen.');
                plan.initialized = true; await this.saveRoom();
            }
            for (const [socket, meta] of this.sockets) if (meta.playerId && plan.transfers[meta.playerId]) this.send(socket, 'roomTransfer', plan.transfers[meta.playerId]);
            return;
        }
        throw new Error('Kein freier Raumcode gefunden. Bitte erneut versuchen.');
    }

    private ejectSpectators(room: RoomState) {
        for (const [socket, meta] of this.sockets) if (room.spectators?.some(p => p.id === meta.playerId)) {
            this.sockets.delete(socket); this.send(socket, 'leftRoom'); socket.close(1000, 'Room empty');
        }
        room.spectators = [];
    }

    private async disconnect(socket: CloudflareWebSocket) {
        const meta = this.sockets.get(socket);
        this.sockets.delete(socket);
        if (!meta || !this.room) return;
        const player = participantForConnection(this.room, meta.socketId);
        if (!player) return;
        player.connected = false;
        player.ready = false;
        player.disconnectedAt = Date.now();
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.scheduleAlarm();
    }

    async alarm() {
        await this.enqueue(async () => {
            for (const [socket, meta] of this.sockets) {
                if (!meta.playerId && meta.acceptedAt && Date.now() >= meta.acceptedAt + 60_000) {
                    this.sockets.delete(socket); socket.close(4008, 'Join timeout');
                }
            }
            const room = this.room;
            if (room) {
                if (this.contentCheckAt <= Date.now()) await this.archiveContentReady(room);
                if (room.state === 'VOTING' && room.previewDeadline && room.previewDeadline <= Date.now() && !room.previewConfirmed) await this.checkVotingComplete(true);
                if (room.phaseDeadline && room.phaseDeadline <= Date.now()) await this.endPhase();
                if (room.sharedImage && room.sharedImage.expiresAt <= Date.now()) {
                    await deleteSharedImage(this.state.storage, room.sharedImage); room.sharedImage = undefined; resetReady(room);
                }
                const wasOver = room.state === 'GAME_OVER';
                for (const p of participants(room)) {
                    if (!p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt >= DISCONNECT_GRACE_MS) {
                        const viewer = isSpectator(room, p);
                        const skipped = viewer ? 0 : removePlayer(room, p.id);
                        if (viewer) room.spectators = room.spectators?.filter(item => item.id !== p.id);
                        if (skipped) await service(this.env, '/quota/drop', { code: room.code, generations: skipped, playerId: p.id });
                    }
                }
                if (!room.players.length) { this.ejectSpectators(room); await service(this.env, '/quota/release', { code: room.code }); this.room = null; }
                else playArchiveVideo(room);
                await this.saveRoom();
                if (this.room && !wasOver && room.state === 'GAME_OVER') await this.queueFinal();
                await this.checkVotingComplete();
                await this.refreshLobbyQuota();
                this.broadcastRoomUpdate();
                if (this.room?.state === 'GENERATING' && room.generationJob && room.generationId
                    && !this.activeGenerations.has(room.generationId) && (room.generationRetryAt || 0) <= Date.now()) this.runGeneration(room);
            }
            await this.flushQuotaReleases();
            for (const [jobId, entry] of Object.entries(this.aiJobs)) {
                if (jobId !== this.room?.generationId && (entry.retryAt || 0) <= Date.now()) this.resumeAbandonedJob(jobId);
            }
            await this.flushPendingRounds();
            await this.scheduleAlarm();
        });
    }

    private async scheduleAlarm() {
        const deadlines = this.room ? participants(this.room).filter(p => !p.connected && p.disconnectedAt).map(p => p.disconnectedAt! + DISCONNECT_GRACE_MS) : [];
        for (const meta of this.sockets.values()) if (!meta.playerId && meta.acceptedAt) deadlines.push(meta.acceptedAt + 60_000);
        if (this.room?.sharedImage) deadlines.push(this.room.sharedImage.expiresAt);
        if (this.room?.phaseDeadline) deadlines.push(this.room.phaseDeadline);
        if (this.room && needsContentCheck(this.room)) deadlines.push(this.contentCheckAt || Date.now() + 100);
        if (this.room?.state === 'VOTING' && this.room.previewDeadline && !this.room.previewConfirmed) deadlines.push(this.room.previewDeadline);
        if (this.room?.currentVideoUrl.startsWith('/api/videos/') && this.room.state !== 'GAME_OVER') deadlines.push(this.archiveLeaseRenewAt || Date.now() + 100);
        if (this.pendingRounds.length) deadlines.push(Date.now() + 30_000);
        if (this.quotaReleases.length) deadlines.push(Date.now() + 15_000);
        for (const [jobId, entry] of Object.entries(this.aiJobs)) {
            if (jobId !== this.room?.generationId && !this.activeGenerations.has(jobId)) deadlines.push(entry.retryAt || Date.now() + 100);
        }
        if (this.room?.state === 'GENERATING' && this.room.generationJob && this.room.generationId
            && !this.activeGenerations.has(this.room.generationId)) deadlines.push(this.room.generationRetryAt || Date.now() + 100);
        if (deadlines.length) {
            const next = Math.max(Date.now() + 100, Math.min(...deadlines));
            const scheduled = await this.state.storage.getAlarm();
            if (scheduled === null || next < scheduled) await this.state.storage.setAlarm(next);
        }
    }

    private async playableArchive(room: RoomState) {
        const clips = await getDatabase(this.env.DATABASE_URL)?.playableArchive(authDisabled(this.env) ? undefined : roomAccountIds(room)) || [];
        const { allowedUrls } = await service(this.env, '/security/content/allowed', { urls: clips.map(clip => clip.videoUrl) });
        const allowed = new Set<string>(allowedUrls || (this.env.AI_PROVIDER === 'mock' ? clips.map(clip => clip.videoUrl) : []));
        return clips.filter(clip => allowed.has(clip.videoUrl));
    }

    private async saveRoom() {
        if (this.room) syncPhase(this.room);
        if (this.room) await this.state.storage.put('room', this.room);
        else {
            const previous = await this.state.storage.get<RoomState>('room');
            await deleteSharedImage(this.state.storage, previous?.sharedImage);
            await this.state.storage.delete('room');
        }
        if (this.room?.currentVideoUrl.startsWith('/api/videos/') && this.room.state !== 'GAME_OVER' && (this.archiveLeaseRenewAt <= Date.now() || this.leasedVideoUrl !== this.room.currentVideoUrl)) {
            await service(this.env, '/archive/protect', { code: this.room.code, url: this.room.currentVideoUrl });
            this.archiveLeaseRenewAt = Date.now() + ARCHIVE_LEASE_MS / 2;
            this.leasedVideoUrl = this.room.currentVideoUrl;
        }
    }

    private broadcastRoomUpdate() {
        if (this.room) { syncPhase(this.room); this.state.waitUntil(this.scheduleAlarm()); }
        if (this.room) for (const [socket, meta] of this.sockets) {
            if (!meta.playerId || !participants(this.room).some(player => player.id === meta.playerId)) continue;
            if (authDisabled(this.env)) { this.send(socket, 'roomDataUpdate', roomSnapshot(this.room, meta.playerId)); continue; }
            if (this.snapshotChecks.has(socket)) continue;
            this.snapshotChecks.add(socket);
            const account = meta.account;
            this.state.waitUntil(accountIsCurrent(account!, cloudflareAuth(this.env)).then(valid => this.enqueue(async () => {
                this.snapshotChecks.delete(socket);
                if (this.sockets.get(socket) !== meta || !this.room) return;
                if (meta.account !== account) { this.broadcastRoomUpdate(); return; }
                const player = participantForConnection(this.room, meta.socketId);
                if (!player) return;
                if (!valid || account!.expiresAt <= Date.now()) { this.send(socket, 'authExpired'); await this.leaveRoom(socket, player); return; }
                // Read the newest state after authorization, never a stale queued snapshot.
                this.send(socket, 'roomDataUpdate', roomSnapshot(this.room, player.id));
            })).catch(() => { this.snapshotChecks.delete(socket); this.send(socket, 'roomNotice', 'Die Sitzungsprüfung ist gerade nicht erreichbar.'); }));
        }
    }
    private async endPhase() {
        const room = this.room;
        if (!room) return;
        if (!await this.archiveContentReady(room)) return;
        const creatorId = activeCreator(room)?.id;
        const result = closePhase(room);
        if (result === 'voted') await this.completeVoting();
        else if (result) {
            if (result === 'skipped' && !isArchiveGame(room)) await service(this.env, '/quota/drop', { code: room.code, generations: 1, playerId: creatorId });
            if (room.state === 'GAME_OVER') await this.queueFinal();
            await this.saveRoom(); this.broadcastRoomUpdate();
        }
    }
    private broadcast(type: string, payload?: unknown) {
        for (const [socket, meta] of this.sockets) {
            if (meta.playerId && this.room && participants(this.room).some(p => p.id === meta.playerId)) this.send(socket, type, payload);
        }
    }
    private send(socket: CloudflareWebSocket, type: string, payload?: unknown) {
        try { socket.send(JSON.stringify({ type, payload })); } catch { this.state.waitUntil(this.enqueue(() => this.disconnect(socket))); }
    }
}
