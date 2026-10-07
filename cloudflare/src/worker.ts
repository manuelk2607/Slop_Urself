import { neon } from '@neondatabase/serverless';
import { Account, AuthConfig, authDisabled, requestAccount, sessionResponse, verifyAccountToken } from '../../auth';
import { Profile, ProfileStore, sqlProfiles, storedProfiles, PROFILE_SCHEMA } from '../../profiles';
import { QuotaBudget, QuotaConfig, QuotaCapacity, playerCount } from '../../quota';
import { ArchiveConfig, archiveVideo, serveVideo, listArchive, archiveEnabled, archiveLimit } from '../../archive';
import { generateAiVideo, resumeAiVideo, AiPendingError, AiExpiredError, AI_RETRY_MS, validateImage, DEFAULT_PROVIDER_CHAIN } from '../../ai';
import { takeRateLimit, rateKey, httpRateRule, MESSAGE_RATE, RATE_MESSAGE, type RateBuckets, type RateRule } from '../../security';
import { logAiEvent } from '../../telemetry';
import { Room as RoomState, Player, activeCreator, playerForConnection, roomSnapshot, finalStandings, removePlayer, finishVoting, sanitizeUsername, sanitizeRoomId, sanitizeSessionId, roundLimit, maxRounds, DISCONNECT_GRACE_MS, SOLO_PREVIEW_MS, startRounds, advanceTurn, remainingVideos, extendRound } from '../../game';

interface Fetcher {
    fetch(request: Request): Promise<Response>;
}

interface DurableObjectId {}

interface DurableObjectNamespace<T> {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub<T>;
}

interface DurableObjectStub<T> {
    fetch(request: Request): Promise<Response>;
}

interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
}

interface DurableObjectState {
    storage: DurableObjectStorage;
    acceptWebSocket(socket: CloudflareWebSocket): void;
    getWebSockets(): CloudflareWebSocket[];
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
    waitUntil(promise: Promise<unknown>): void;
}

interface CloudflareWebSocket extends WebSocket {
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): ConnectionMeta;
}

declare class WebSocketPair {
    0: CloudflareWebSocket;
    1: CloudflareWebSocket;
}

export interface Env extends AuthConfig, QuotaConfig, ArchiveConfig {
    ASSETS: Fetcher;
    ROOMS: DurableObjectNamespace<RoomDurableObject>;
    SERVICES?: DurableObjectNamespace<ServiceDurableObject>;
    HF_TOKEN?: string;
    DATABASE_URL?: string;
    AI_PROVIDER?: string;
    AI_PROVIDER_CHAIN?: string;
    HF_SPACE_ID?: string;
    HF_PREDICT_ENDPOINT?: string;
    AI_ROUND_LIMIT?: string;
    LTX_DURATION?: string;
    LTX_HEIGHT?: string;
    LTX_WIDTH?: string;
    LTX_GUIDANCE?: string;
    LTX_FRAMES?: string;
    LTX_ENHANCE_PROMPT?: string;
}

interface FinalStandingInput { playerSocketId: string; name: string; score: number; finalRank: number }
type PendingRoomWrite = RoomState & { writeAction?: 'continue' };
interface ConnectionMeta { socketId: string; sessionId?: string; playerId?: string; account?: Account }

async function service(env: Env, path: string, payload?: unknown) {
    if (!env.SERVICES && env.AI_PROVIDER === 'mock') return { aiRoundLimit: getAiRoundLimit(env), playerCount: (payload as { players?: number })?.players || 1, quotaMode: 'mock' };
    if (!env.SERVICES) throw new Error('Cloudflare SERVICES-Binding fehlt.');
    const response = await env.SERVICES.get(env.SERVICES.idFromName('global')).fetch(new Request(`https://internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) }));
    const result = await response.json() as Record<string, any>;
    if (!response.ok) throw new Error(result.error || 'KI- oder Videospeicher nicht erreichbar.');
    return result;
}

export class ServiceDurableObject {
    private quotaOperations: Promise<unknown> = Promise.resolve();
    private archiveOperations: Promise<unknown> = Promise.resolve();
    private profileOperations: Promise<unknown> = Promise.resolve();
    private securityOperations: Promise<unknown> = Promise.resolve();
    private profiles: ProfileStore;
    private budget: QuotaBudget;
    constructor(private state: DurableObjectState, private env: Env) {
        this.budget = new QuotaBudget(state.storage, env);
        this.profiles = env.DATABASE_URL ? sqlProfiles(async (sql, values) => await getSql(env)!.query(sql, values) as Profile[]) : storedProfiles(state.storage);
    }
    async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        const action = async () => {
            const data = await request.json() as { code: string; rounds: number; players?: number; generations: number; seconds: number; jobId?: string; url: string; name: string; key: string; rule: RateRule };
            if (path === '/security/rate') {
                const buckets = await this.state.storage.get<RateBuckets>('rateBuckets') || {};
                const retryAfter = takeRateLimit(buckets, data.key, data.rule);
                await this.state.storage.put('rateBuckets', buckets);
                return json({ retryAfter });
            }
            if (path === '/quota/display') return json(await this.budget.displayCapacity(data.players));
            if (path === '/quota/capacity') return json(await this.budget.capacity(data.players));
            if (path === '/quota/reserve') await this.budget.reserve(data.code, data.rounds, data.players);
            else if (path === '/quota/extend') await this.budget.extend(data.code, data.players!);
            else if (path === '/quota/begin') await this.budget.begin(data.code, data.generations, data.jobId);
            else if (path === '/quota/consume') await this.budget.consume(data.code, data.jobId);
            else if (path === '/quota/release') await this.budget.release(data.code);
            else if (path === '/quota/drop') await this.budget.drop(data.code, data.generations);
            else if (path === '/quota/attempt') await this.budget.allowAttempt(data.code, data.seconds, data.jobId);
            else if (path === '/archive') return json({ url: await archiveVideo(data.url, this.env) });
            else if (path === '/archive/status') { const objects = await listArchive(this.env); return json({ enabled: archiveEnabled(this.env), usedBytes: objects.reduce((sum, item) => sum + item.size, 0), maxBytes: archiveLimit(this.env), videoCount: objects.length }); }
            else if (path === '/profiles/create') return json({ profile: await this.profiles.create(data.name) || null });
            else if (path === '/profiles/find') return json({ profile: await this.profiles.find(data.name) || null });
            return json({ ok: true });
        };
        const result = (path.startsWith('/security/') ? this.securityOperations : path.startsWith('/quota/') ? this.quotaOperations : path.startsWith('/profiles/') ? this.profileOperations : this.archiveOperations).then(action).catch(error => json({ error: error instanceof Error ? error.message : 'Dienst nicht erreichbar.' }, { status: 503 }));
        if (path.startsWith('/security/')) this.securityOperations = result;
        else if (path.startsWith('/quota/')) this.quotaOperations = result;
        else if (path.startsWith('/profiles/')) this.profileOperations = result;
        else this.archiveOperations = result;
        return result;
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const rule = httpRateRule(url.pathname, request.method);
        if (rule) {
            try {
                const key = await rateKey(request.headers.get('CF-Connecting-IP') || 'local', url.pathname.startsWith('/ws/') ? '/ws/' : url.pathname, env.AUTH_COOKIE_SECRET);
                const { retryAfter } = await service(env, '/security/rate', { key, rule });
                if (retryAfter) return json({ error: RATE_MESSAGE }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
            } catch { return json({ error: 'Das Spiel ist gerade nicht erreichbar.' }, { status: 503 }); }
        }

        if (url.pathname.startsWith('/api/auth/')) return new Response(null, { status: 404 });
        if (url.pathname === '/api/session') return sessionResponse(request, env, {
            create: async name => (await service(env, '/profiles/create', { name })).profile || undefined,
            find: async name => (await service(env, '/profiles/find', { name })).profile || undefined
        });

        if (url.pathname === '/api/config') {
            let players: number;
            try { players = playerCount(url.searchParams.get('players') ?? 1); } catch { return json({ error: 'Ungueltige Spielerzahl.' }, { status: 400 }); }
            const signedIn = authDisabled(env) || Boolean(await requestAccount(request, env).catch(() => undefined));
            return json({
                ...(signedIn ? await service(env, '/quota/display', { players }) : { aiRoundLimit: 0, quotaMode: 'unavailable' }),
                authEnabled: !authDisabled(env),
                aiProvider: env.AI_PROVIDER === 'mock' ? 'mock' : env.AI_PROVIDER_CHAIN || env.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN,
                mockAi: env.AI_PROVIDER === 'mock',
                videoDuration: Math.max(5, Number(env.LTX_DURATION) || 5)
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        if (url.pathname === '/api/stats') {
            try { await requestAccount(request, env); } catch { return json({ error: 'Bitte melde dich an.' }, { status: 401 }); }
            try {
                const stats = await getStats(env);
                return json({
                    databaseEnabled: Boolean(env.DATABASE_URL),
                    ...stats,
                    videoStorageMode: archiveEnabled(env) ? 'archive' : 'url',
                    archive: await service(env, '/archive/status').catch(() => null)
                });
            } catch (error) {
                console.error('[DB] Statistics unavailable', error instanceof Error ? error.message : 'Database error');
                return json({ error: 'Statistiken konnten nicht geladen werden.' }, { status: 503 });
            }
        }

        if (url.pathname.startsWith('/api/videos/')) {
            try { await requestAccount(request, env); } catch { return new Response(null, { status: 401 }); }
            return serveVideo(request, url.pathname.slice('/api/videos/'.length), env);
        }

        if (url.pathname === '/socket.io/socket.io.js') {
            return new Response('// Cloudflare uses native WebSockets.', { headers: { 'content-type': 'application/javascript' } });
        }

        if (url.pathname.startsWith('/ws/')) {
            if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return new Response('Invalid origin', { status: 403 });
            const roomCode = sanitizeRoomId(url.pathname.replace('/ws/', ''));
            if (!roomCode) return new Response('Missing room code', { status: 400 });
            try { await requestAccount(request, env); } catch { return new Response('Bitte melde dich an.', { status: 401 }); }

            const id = env.ROOMS.idFromName(roomCode);
            const room = env.ROOMS.get(id);
            return room.fetch(request);
        }

        return env.ASSETS.fetch(request);
    }
};

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

    constructor(private state: DurableObjectState, private env: Env) {
        state.blockConcurrencyWhile(async () => {
            this.room = (await state.storage.get<RoomState>('room')) || null;
            this.pendingRounds = (await state.storage.get<PendingRoomWrite[]>('pendingRounds')) || [];
            this.quotaReleases = (await state.storage.get<typeof this.quotaReleases>('quotaReleases')) || [];
            this.aiJobs = (await state.storage.get<typeof this.aiJobs>('aiJobs')) || {};
            for (const socket of state.getWebSockets()) this.sockets.set(socket, socket.deserializeAttachment());
            if (this.room) {
                this.roomCode = this.room.code;
                for (const player of this.room.players) {
                    const connection = [...this.sockets.values()].find(meta => meta.playerId === player.id);
                    player.connected = Boolean(connection);
                    if (connection) player.connectionId = connection.socketId;
                    else player.disconnectedAt ??= Date.now();
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

    private enqueue(action: () => Promise<void>) {
        const next = this.operations.then(action);
        this.operations = next.catch(error => {
            console.error('[Room] Operation failed', error instanceof Error ? error.message : 'Unknown error');
        });
        return next;
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket upgrade', { status: 426 });
        this.roomCode = sanitizeRoomId(new URL(request.url).pathname.replace('/ws/', ''));
        const pair = new WebSocketPair();
        const socketId = crypto.randomUUID();
        const meta: ConnectionMeta = { socketId, account: await requestAccount(request, this.env) };
        this.state.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment(meta);
        this.sockets.set(pair[1], meta);
        this.send(pair[1], 'connect', { socketId });
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: CloudflareWebSocket });
    }

    async webSocketMessage(socket: CloudflareWebSocket, data: string | ArrayBuffer) {
        await this.enqueue(async () => {
            try {
                if (typeof data !== 'string' || data.length > 12 * 1024 * 1024) throw new Error('Ungueltige Nachricht oder Bild zu gross.');
                const message = JSON.parse(data) as { type?: string; payload?: Record<string, unknown> };
                if (!message || typeof message.type !== 'string' || (message.payload && (typeof message.payload !== 'object' || Array.isArray(message.payload)))) throw new Error('Ungueltige Nachricht.');
                const payload = message.payload || {};
                const meta = this.sockets.get(socket);
                if (!meta) return;
                if (takeRateLimit(this.messageBuckets, meta.account?.id || meta.playerId || meta.socketId, MESSAGE_RATE)) throw new Error(RATE_MESSAGE);
                if (message.type === 'refreshAuth') {
                    const account = await verifyAccountToken(payload.token, this.env);
                    if (meta.account?.id !== account.id) throw new Error('Bitte verbinde dich erneut.');
                    meta.account = account; socket.serializeAttachment(meta); return;
                }
                if (!authDisabled(this.env) && (!meta.account || meta.account.expiresAt < Date.now())) { this.send(socket, 'authExpired'); return; }
                if (message.type === 'createRoom') await this.createRoom(socket, meta, payload);
                else if (message.type === 'joinRoom') await this.joinRoom(socket, meta, payload);
                else if (message.type === 'resumeRoom') await this.resumeRoom(socket, meta, payload);
                else {
                    const player = this.room && playerForConnection(this.room, meta.socketId);
                    if (!player || meta.playerId !== player.id) throw new Error('Bitte verbinde dich zuerst mit dem Raum.');
                    if (message.type === 'leaveRoom') await this.leaveRoom(socket, player);
                    else if (message.type === 'refreshQuota') await this.refreshLobbyQuota();
                    else if (message.type === 'setRoundCount') await this.setRoundCount(player, payload);
                    else if (message.type === 'startGame') await this.startGame(player);
                    else if (message.type === 'sendImage') await this.sendImage(player, payload);
                    else if (message.type === 'submitVote') await this.submitVote(player, payload);
                    else if (message.type === 'startNextRound') await this.startNextRound(player);
                    else if (message.type === 'extendGame') await this.extendGame(player, payload);
                }
            } catch (error) {
                this.send(socket, 'errorMsg', error instanceof Error ? error.message : 'Nachricht konnte nicht verarbeitet werden.');
            }
        });
    }

    async webSocketClose(socket: CloudflareWebSocket) { await this.enqueue(() => this.disconnect(socket)); }
    async webSocketError(socket: CloudflareWebSocket) { await this.enqueue(() => this.disconnect(socket)); }

    private bind(socket: CloudflareWebSocket, meta: ConnectionMeta, player: Player) {
        meta.playerId = player.id;
        meta.sessionId = player.sessionId;
        player.connectionId = meta.socketId;
        socket.serializeAttachment(meta);
    }

    private async createRoom(socket: CloudflareWebSocket, meta: ConnectionMeta, payload: Record<string, unknown>) {
        if (meta.playerId) throw new Error('Du bist bereits in einem Raum.');
        const username = meta.account?.name || sanitizeUsername(payload.username);
        if (!username) throw new Error('Bitte gib einen Spielernamen ein.');
        const sql = getSql(this.env);
        if (sql) await ensureDatabaseSchema(this.env);
        if (this.room || (sql && (await sql`select code from rooms where code = ${this.roomCode}`).length)) {
            this.send(socket, 'roomCodeConflict');
            return;
        }
        const capacity = await service(this.env, '/quota/capacity');
        if (capacity.aiRoundLimit < 1) throw new Error(capacity.error || 'Das kostenlose KI-Kontingent ist aufgebraucht.');
        const player: Player = { id: meta.socketId, accountId: meta.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || crypto.randomUUID(), name: username, score: 0, connected: true };
        this.room = {
            code: this.roomCode, hostId: player.id, players: [player], state: 'LOBBY',
            activeCreatorIndex: 0, currentVotes: {}, currentRound: 1,
            maxRounds: maxRounds(payload.maxRounds, capacity.aiRoundLimit), currentPrompt: '', currentVideoUrl: '', quota: capacity as QuotaCapacity
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
        if (room.state !== 'LOBBY') throw new Error('Dieses Spiel wurde bereits gestartet.');
        const name = meta.account?.name || sanitizeUsername(payload.username);
        if (!name) throw new Error('Bitte gib einen Spielernamen ein.');
        if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('Dieser Spielername ist im Raum bereits vergeben.');
        if (meta.account && room.players.some(p => p.accountId === meta.account!.id)) throw new Error('Dieses Konto ist bereits im Raum.');
        const player: Player = { id: meta.socketId, accountId: meta.account?.id, sessionId: sanitizeSessionId(payload.sessionId) || crypto.randomUUID(), name, score: 0, connected: true };
        if (room.players.some(p => p.sessionId === player.sessionId)) throw new Error('Diese Sitzung ist bereits im Raum.');
        room.players.push(player);
        this.bind(socket, meta, player);
        await this.saveRoom();
        this.send(socket, 'joinedSuccess', { roomId: room.code, sessionId: player.sessionId, playerId: player.id });
        await this.refreshLobbyQuota();
        this.broadcastRoomUpdate();
        await this.persistMembers();
    }

    private async resumeRoom(socket: CloudflareWebSocket, meta: ConnectionMeta, payload: Record<string, unknown>) {
        const room = this.room;
        const player = room?.players.find(p => p.sessionId === sanitizeSessionId(payload.sessionId));
        if (!room || !player || (!authDisabled(this.env) && player.accountId !== meta.account?.id)) { this.send(socket, 'resumeFailed'); return; }
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
        const skipped = removePlayer(room, player.id);
        if (skipped) await service(this.env, '/quota/drop', { code: room.code, generations: skipped });
        this.sockets.delete(socket);
        if (!this.room.players.length) { await service(this.env, '/quota/release', { code: this.roomCode }); this.room = null; }
        await this.saveRoom();
        this.send(socket, 'leftRoom');
        socket.close(1000, 'Left room');
        this.broadcast('roomNotice', `${player.name} hat das Spiel verlassen.`);
        if (this.room && !wasOver && room.state === 'GAME_OVER') await this.queueFinal();
        await this.checkVotingComplete();
        await this.refreshLobbyQuota();
        this.broadcastRoomUpdate();
        await this.scheduleAlarm();
    }

    private async startGame(player: Player) {
        const room = this.room!;
        if (room.state !== 'LOBBY' || room.hostId !== player.id) return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        await this.refreshLobbyQuota();
        if (!room.maxRounds) throw new Error('Das KI-Kontingent reicht derzeit nicht fuer eine vollstaendige Runde mit allen Spielern.');
        await service(this.env, '/quota/reserve', { code: room.code, rounds: room.maxRounds, players: room.players.length });
        startRounds(room);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.persistMembers();
    }

    private async refreshLobbyQuota() {
        const room = this.room;
        if (!room || (room.state !== 'LOBBY' && room.state !== 'GAME_OVER')) return;
        const capacity = await service(this.env, '/quota/capacity', { players: room.players.length }) as QuotaCapacity;
        if (room.state === 'GAME_OVER') room.extensionQuota = capacity;
        else {
            room.quota = capacity;
            room.maxRounds = capacity.aiRoundLimit ? maxRounds(room.maxRounds || 1, capacity.aiRoundLimit) : 0;
        }
        await this.saveRoom();
        this.broadcastRoomUpdate();
    }

    private async setRoundCount(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (room.state !== 'LOBBY' || room.hostId !== player.id) return;
        await this.refreshLobbyQuota();
        if (!room.quota?.aiRoundLimit) throw new Error('Das KI-Kontingent reicht derzeit nicht fuer eine vollstaendige Runde mit allen Spielern.');
        room.maxRounds = maxRounds(payload.rounds, room.quota.aiRoundLimit);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.persistMembers();
    }

    private async sendImage(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (room.state !== 'IDLE' || activeCreator(room)?.id !== player.id) return;
        const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim().slice(0, 150) : '';
        if (!prompt) throw new Error('Bitte gib einen Prompt ein.');
        validateImage(payload.imageBase64);
        const generationId = crypto.randomUUID();
        await service(this.env, '/quota/begin', { code: room.code, generations: remainingVideos(room), jobId: generationId });
        room.state = 'GENERATING';
        room.generationId = generationId;
        room.currentPrompt = prompt;
        room.currentVideoUrl = '';
        room.currentVotes = {};
        room.generationJob = undefined;
        await this.saveRoom();
        this.broadcastRoomUpdate();
        this.runGeneration(room, payload.imageBase64 as string);
    }

    private runGeneration(room: RoomState, image?: string) {
        const generationId = room.generationId!;
        if (this.activeGenerations.has(generationId)) return;
        this.activeGenerations.add(generationId);
        room.generationRetryAt = undefined;
        const progress = (step: string) => {
            if (this.room === room && room.generationId === generationId) this.broadcast('generationProgress', { step });
        };
        const lifecycle = {
            context: { generationId, roomCode: room.code, videoNumber: room.videoNumber || room.currentRound },
            saveJob: async (job: NonNullable<RoomState['generationJob']>) => this.enqueue(async () => {
                this.aiJobs[generationId] = { code: room.code, job };
                await this.state.storage.put('aiJobs', this.aiJobs);
                if (this.room !== room || room.generationId !== generationId) return;
                room.generationJob = job;
                await this.saveRoom();
            })
        };
        const generation = image ? generateAiVideo(image, room.currentPrompt, this.env, progress,
            seconds => service(this.env, '/quota/attempt', { code: room.code, seconds, jobId: generationId }).then(() => {}), lifecycle)
            : resumeAiVideo(room.generationJob!, this.env, progress, lifecycle);
        const work = generation
        .then(async videoUrl => {
            if (this.room !== room || room.generationId !== generationId) return videoUrl;
            try { return (await service(this.env, '/archive', { url: videoUrl })).url as string; }
            catch { this.broadcast('roomNotice', 'Das Video kann gerade nicht archiviert werden. Der temporaere Link bleibt abspielbar.'); return videoUrl; }
        }).then(videoUrl => this.enqueue(async () => {
            await this.releaseGenerationQuota(room.code, generationId);
            if (this.room !== room || room.generationId !== generationId || room.state !== 'GENERATING') return;
            room.currentVideoUrl = videoUrl;
            room.state = 'VOTING';
            if (room.players.length === 1) room.soloFinishAt = Date.now() + SOLO_PREVIEW_MS;
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
                await this.saveRoom();
                this.broadcast('generationProgress', { step: 'Videoerstellung laeuft weiter...' });
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

    private resumeAbandonedJob(jobId: string) {
        const entry = this.aiJobs[jobId];
        if (!entry || this.activeGenerations.has(jobId)) return;
        this.activeGenerations.add(jobId);
        const context = { generationId: jobId, roomCode: entry.code };
        const work = resumeAiVideo(entry.job, this.env, undefined, { context }).then(
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
            try { await service(this.env, '/quota/consume', this.quotaReleases[0]); }
            catch { break; }
            this.quotaReleases.shift();
            await this.state.storage.put('quotaReleases', this.quotaReleases);
        }
    }

    private async submitVote(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (room.state !== 'VOTING' || activeCreator(room)?.id === player.id) return;
        if (room.currentVotes[player.id] !== undefined) return;
        const points = Number(payload.points);
        if (!Number.isInteger(points) || points < 1 || points > 5) throw new Error('Bitte vergib 1 bis 5 Punkte.');
        room.currentVotes[player.id] = points;
        await this.saveRoom();
        await this.checkVotingComplete();
        this.broadcastRoomUpdate();
    }

    private async startNextRound(player: Player) {
        const room = this.room!;
        if (room.state !== 'RESULTS' || room.hostId !== player.id) return;
        advanceTurn(room);
        await this.saveRoom();
        this.broadcastRoomUpdate();
    }

    private async extendGame(player: Player, payload: Record<string, unknown>) {
        const room = this.room!;
        if (room.state !== 'GAME_OVER' || room.hostId !== player.id) return;
        if (Number(payload.completedVideo) !== (room.videoNumber || room.currentRound)) return;
        if (room.players.some(p => !p.connected)) throw new Error('Warte, bis alle Spieler verbunden sind.');
        await this.refreshLobbyQuota();
        await service(this.env, '/quota/extend', { code: room.code, players: room.players.length });
        extendRound(room);
        this.pendingRounds.push({ ...structuredClone(room), writeAction: 'continue' });
        await this.state.storage.put('pendingRounds', this.pendingRounds);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.flushPendingRounds();
    }

    private async checkVotingComplete() {
        const room = this.room;
        if (!room || !finishVoting(room)) return;
        if (room.state === 'GAME_OVER') await service(this.env, '/quota/release', { code: room.code });
        this.pendingRounds.push(structuredClone(room));
        await this.state.storage.put('pendingRounds', this.pendingRounds);
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.flushPendingRounds();
        await this.refreshLobbyQuota();
    }

    private async queueFinal() {
        if (!this.room) return;
        await service(this.env, '/quota/release', { code: this.room.code });
        this.pendingRounds.push(structuredClone(this.room));
        await this.state.storage.put('pendingRounds', this.pendingRounds);
        await this.flushPendingRounds();
        await this.refreshLobbyQuota();
    }

    private async persistMembers() {
        const room = this.room;
        if (!room) return;
        try {
            await persistRoom(this.env, room.code, room.hostId, room.maxRounds);
            await persistScores(this.env, room.code, room.players, room.hostId);
            if (room.state !== 'LOBBY') await markRoomStarted(this.env, room.code);
        } catch (error) {
            console.error('[DB] Members not saved', error instanceof Error ? error.message : 'Database error');
            this.broadcast('roomNotice', 'Die Statistik-Speicherung ist momentan nicht erreichbar.');
        }
    }

    private async flushPendingRounds() {
        if (!this.env.DATABASE_URL) { this.pendingRounds = []; await this.state.storage.delete('pendingRounds'); return; }
        while (this.pendingRounds.length) {
            const room = this.pendingRounds[0];
            const creator = activeCreator(room)!;
            try {
                await persistRoom(this.env, room.code, room.hostId, room.maxRounds);
                await markRoomStarted(this.env, room.code);
                if (room.writeAction === 'continue') await persistContinuation(this.env, room);
                else if (room.state === 'GAME_OVER' && !room.lastResult) await persistFinal(this.env, room);
                else await persistRound(this.env, room.code, {
                    roundNumber: room.videoNumber || room.currentRound, creatorSocketId: creator.id,
                    prompt: room.currentPrompt, videoUrl: room.currentVideoUrl,
                    roundPoints: room.lastResult!.roundPoints,
                    votes: Object.entries(room.currentVotes).map(([voterSocketId, points]) => ({ voterSocketId, points })),
                    players: room.players, hostId: room.hostId,
                    standings: room.state === 'GAME_OVER' ? finalStandings(room) : undefined
                });
                this.pendingRounds.shift();
                await this.state.storage.put('pendingRounds', this.pendingRounds);
            } catch (error) {
                console.error('[DB] Round not saved', error instanceof Error ? error.message : 'Database error');
                this.broadcast('roomNotice', 'Statistiken werden gespeichert, sobald die Datenbank wieder erreichbar ist.');
                break;
            }
        }
        await this.scheduleAlarm();
    }

    private async disconnect(socket: CloudflareWebSocket) {
        const meta = this.sockets.get(socket);
        this.sockets.delete(socket);
        if (!meta || !this.room) return;
        const player = playerForConnection(this.room, meta.socketId);
        if (!player) return;
        player.connected = false;
        player.disconnectedAt = Date.now();
        await this.saveRoom();
        this.broadcastRoomUpdate();
        await this.scheduleAlarm();
    }

    async alarm() {
        await this.enqueue(async () => {
            const room = this.room;
            if (room) {
                const wasOver = room.state === 'GAME_OVER';
                for (const p of [...room.players]) {
                    if (!p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt >= DISCONNECT_GRACE_MS) {
                        const skipped = removePlayer(room, p.id);
                        if (skipped) await service(this.env, '/quota/drop', { code: room.code, generations: skipped });
                    }
                }
                if (!room.players.length) { await service(this.env, '/quota/release', { code: room.code }); this.room = null; }
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
        const deadlines = this.room?.players.filter(p => !p.connected && p.disconnectedAt).map(p => p.disconnectedAt! + DISCONNECT_GRACE_MS) || [];
        if (this.room?.soloFinishAt) deadlines.push(this.room.soloFinishAt);
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

    private async saveRoom() {
        if (this.room) await this.state.storage.put('room', this.room);
        else await this.state.storage.delete('room');
    }

    private broadcastRoomUpdate() { if (this.room) this.broadcast('roomDataUpdate', roomSnapshot(this.room)); }
    private broadcast(type: string, payload?: unknown) {
        for (const [socket, meta] of this.sockets) {
            if (meta.playerId && this.room?.players.some(p => p.id === meta.playerId)) this.send(socket, type, payload);
        }
    }
    private send(socket: CloudflareWebSocket, type: string, payload?: unknown) {
        try { socket.send(JSON.stringify({ type, payload })); } catch { this.state.waitUntil(this.enqueue(() => this.disconnect(socket))); }
    }
}

function json(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(body), {
        ...init,
        headers
    });
}

function getAiRoundLimit(env: Env) { return roundLimit(env.AI_ROUND_LIMIT); }

function getSql(env: Env) {
    return env.DATABASE_URL ? neon(env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(10_000) } }) : null;
}

const schemaReady = new Map<string, Promise<void>>();

async function ensureDatabaseSchema(env: Env) {
    if (!env.DATABASE_URL) return;
    let ready = schemaReady.get(env.DATABASE_URL);
    if (!ready) {
        ready = initializeDatabaseSchema(env).catch(error => { schemaReady.delete(env.DATABASE_URL!); throw error; });
        schemaReady.set(env.DATABASE_URL, ready);
    }
    await ready;
}

async function initializeDatabaseSchema(env: Env) {
    const sql = getSql(env);
    if (!sql) return;

    await sql.query(PROFILE_SCHEMA);
    await sql`
        create table if not exists rooms (
            code text primary key,
            host_socket_id text not null,
            max_rounds integer not null,
            status text not null,
            winner_socket_id text,
            winner_name text,
            created_at timestamptz not null default now(),
            started_at timestamptz,
            ended_at timestamptz
        )
    `;
    await sql`
        create table if not exists players (
            room_code text not null references rooms(code) on delete cascade,
            socket_id text not null,
            name text not null,
            score integer not null default 0,
            final_rank integer,
            is_host boolean not null default false,
            joined_at timestamptz not null default now(),
            primary key (room_code, socket_id)
        )
    `;
    await sql`
        create table if not exists rounds (
            id bigserial primary key,
            room_code text not null references rooms(code) on delete cascade,
            round_number integer not null,
            creator_socket_id text not null,
            prompt text not null,
            video_url text not null,
            round_points integer not null,
            created_at timestamptz not null default now(),
            unique (room_code, round_number)
        )
    `;
    await sql`
        create table if not exists votes (
            round_id bigint not null references rounds(id) on delete cascade,
            voter_socket_id text not null,
            points integer not null,
            created_at timestamptz not null default now(),
            primary key (round_id, voter_socket_id)
        )
    `;
    await sql`create index if not exists players_name_idx on players(name)`;
    await sql`create index if not exists rounds_room_code_idx on rounds(room_code)`;
    await sql`create index if not exists votes_voter_socket_id_idx on votes(voter_socket_id)`;
    await sql`alter table rooms add column if not exists winner_socket_id text`;
    await sql`alter table rooms add column if not exists winner_name text`;
    await sql`alter table players add column if not exists final_rank integer`;
    await sql`alter table players add column if not exists account_id text`;
    await sql`create index if not exists players_account_id_idx on players(account_id)`;
}

async function persistRoom(env: Env, code: string, hostSocketId: string, maxRounds: number) {
    const sql = getSql(env);
    if (!sql) return;
    await ensureDatabaseSchema(env);
    await sql`
        insert into rooms (code, host_socket_id, max_rounds, status)
        values (${code}, ${hostSocketId}, ${maxRounds}, 'LOBBY')
        on conflict (code) do update set max_rounds = excluded.max_rounds
        where rooms.started_at is null
    `;
}

async function persistPlayer(env: Env, roomCode: string, player: { playerSocketId: string; accountId?: string; name: string; score: number; isHost: boolean }) {
    const sql = getSql(env);
    if (!sql) return;
    await ensureDatabaseSchema(env);
    await sql`
        insert into players (room_code, socket_id, name, score, is_host, account_id)
        values (${roomCode}, ${player.playerSocketId}, ${player.name}, ${player.score}, ${player.isHost}, ${player.accountId ?? null})
        on conflict (room_code, socket_id) do update
        set name = excluded.name,
            score = excluded.score,
            is_host = excluded.is_host,
            account_id = coalesce(players.account_id, excluded.account_id)
    `;
}

async function persistScores(env: Env, roomCode: string, players: Player[], hostId: string) {
    await Promise.all(players.map(player => persistPlayer(env, roomCode, {
        playerSocketId: player.id,
        accountId: player.accountId,
        name: player.name,
        score: player.score,
        isHost: player.id === hostId
    })));
}

async function markRoomStarted(env: Env, roomCode: string) {
    const sql = getSql(env);
    if (!sql) return;
    await ensureDatabaseSchema(env);
    await sql`
        update rooms
        set status = case when ended_at is null then 'PLAYING' else status end,
            started_at = coalesce(started_at, now())
        where code = ${roomCode}
    `;
}


async function persistFinal(env: Env, room: RoomState) {
    const sql = getSql(env);
    if (!sql) return;
    const standings = finalStandings(room);
    const winner = standings[0];
    const players = JSON.stringify(standings.map(p => ({ id: p.playerSocketId, score: p.score, rank: p.finalRank })));
    await sql.transaction([
        sql`update players set score = p.score, final_rank = p.rank
            from jsonb_to_recordset(${players}::jsonb) as p(id text, score integer, rank integer)
            where room_code = ${room.code} and socket_id = p.id`,
        sql`update rooms set status = 'GAME_OVER', ended_at = coalesce(ended_at, now()),
            winner_socket_id = ${winner?.playerSocketId ?? null}, winner_name = ${winner?.name ?? null}
            where code = ${room.code}`
    ]);
}

async function persistContinuation(env: Env, room: RoomState) {
    const sql = getSql(env);
    if (!sql) return;
    await sql.transaction([
        sql`update rooms set status = 'PLAYING', max_rounds = ${room.maxRounds}, host_socket_id = ${room.hostId},
            ended_at = null, winner_socket_id = null, winner_name = null where code = ${room.code}`,
        sql`update players set final_rank = null, is_host = (socket_id = ${room.hostId}) where room_code = ${room.code}`
    ]);
}

async function persistRound(env: Env, roomCode: string, input: {
    roundNumber: number; creatorSocketId: string; prompt: string; videoUrl: string; roundPoints: number;
    votes: { voterSocketId: string; points: number }[];
    players: Player[]; hostId: string; standings?: FinalStandingInput[];
}) {
    const sql = getSql(env);
    if (!sql) return;
    await ensureDatabaseSchema(env);
    const players = JSON.stringify(input.players.map(p => ({
        id: p.id, account: p.accountId ?? null, name: p.name, score: p.score, host: p.id === input.hostId,
        rank: input.standings?.find(s => s.playerSocketId === p.id)?.finalRank ?? null
    })));
    const votes = JSON.stringify(input.votes);
    const queries = [
        sql`insert into players (room_code, socket_id, name, score, is_host, final_rank, account_id)
            select ${roomCode}, p.id, p.name, p.score, p.host, p.rank, p.account
            from jsonb_to_recordset(${players}::jsonb) as p(id text, account text, name text, score integer, host boolean, rank integer)
            on conflict (room_code, socket_id) do update set score = excluded.score, is_host = excluded.is_host, final_rank = excluded.final_rank, account_id = coalesce(players.account_id, excluded.account_id)`,
        sql`with saved_round as (
            insert into rounds (room_code, round_number, creator_socket_id, prompt, video_url, round_points)
            values (${roomCode}, ${input.roundNumber}, ${input.creatorSocketId}, ${input.prompt}, ${input.videoUrl}, ${input.roundPoints})
            on conflict (room_code, round_number) do update set
                creator_socket_id = excluded.creator_socket_id, prompt = excluded.prompt,
                video_url = excluded.video_url, round_points = excluded.round_points
            returning id
        )
        insert into votes (round_id, voter_socket_id, points)
        select r.id, v."voterSocketId", v.points from saved_round r,
            jsonb_to_recordset(${votes}::jsonb) as v("voterSocketId" text, points integer)
        on conflict (round_id, voter_socket_id) do update set points = excluded.points`
    ];
    if (input.standings) {
        const winner = input.standings[0];
        queries.push(sql`update rooms set status = 'GAME_OVER', ended_at = coalesce(ended_at, now()),
            winner_socket_id = ${winner?.playerSocketId ?? null}, winner_name = ${winner?.name ?? null}
            where code = ${roomCode}`);
    }
    await sql.transaction(queries);
}

async function getStats(env: Env) {
    const sql = getSql(env);
    if (!sql) {
        return {
            overview: {
                gamesPlayed: 0,
                completedGames: 0,
                roundsPlayed: 0,
                votesCast: 0,
                videosArchived: 0,
                highestScore: 0
            },
            players: [],
            recentVideos: []
        };
    }

    await ensureDatabaseSchema(env);
    const overview = await sql`
        select
            count(*) filter (where started_at is not null)::int as "gamesPlayed",
            count(*) filter (where status = 'GAME_OVER')::int as "completedGames",
            (select count(*)::int from rounds) as "roundsPlayed",
            (select count(*)::int from votes) as "votesCast",
            (select count(*)::int from rounds where video_url <> '') as "videosArchived",
            coalesce((select max(score)::int from players), 0) as "highestScore"
        from rooms
    `;
    const players = await sql`
        with player_totals as (
            select
                coalesce(account_id, 'legacy:' || lower(name)) as player_key,
                max(name) as name,
                count(distinct room_code) as "gamesPlayed",
                count(*) filter (where final_rank = 1)::int as wins,
                coalesce(sum(score), 0)::int as "totalScore",
                coalesce(avg(score), 0)::float as "averageScore"
            from players
            where room_code in (select code from rooms where started_at is not null)
            group by coalesce(account_id, 'legacy:' || lower(name))
        ),
        created_rounds as (
            select
                coalesce(p.account_id, 'legacy:' || lower(p.name)) as player_key,
                count(r.id)::int as "roundsCreated",
                coalesce(avg(r.round_points), 0)::float as "averageReceivedPoints"
            from rounds r
            join players p
              on p.room_code = r.room_code
             and p.socket_id = r.creator_socket_id
            group by coalesce(p.account_id, 'legacy:' || lower(p.name))
        ),
        given_votes as (
            select
                coalesce(p.account_id, 'legacy:' || lower(p.name)) as player_key,
                count(v.points)::int as "votesGiven",
                coalesce(avg(v.points), 0)::float as "averageVoteGiven"
            from votes v
            join rounds r on r.id = v.round_id
            join players p
              on p.room_code = r.room_code
             and p.socket_id = v.voter_socket_id
            group by coalesce(p.account_id, 'legacy:' || lower(p.name))
        )
        select
            pt.name,
            pt."gamesPlayed"::int,
            coalesce(cr."roundsCreated", 0)::int as "roundsCreated",
            round(pt."averageScore"::numeric, 2)::float as "averageScore",
            round(coalesce(cr."averageReceivedPoints", 0)::numeric, 2)::float as "averageReceivedPoints",
            pt."totalScore"::int,
            pt.wins::int,
            coalesce(gv."votesGiven", 0)::int as "votesGiven",
            round(coalesce(gv."averageVoteGiven", 0)::numeric, 2)::float as "averageVoteGiven"
        from player_totals pt
        left join created_rounds cr on cr.player_key = pt.player_key
        left join given_votes gv on gv.player_key = pt.player_key
        order by pt."totalScore" desc, pt.name asc
        limit 50
    `;
    const recentVideos = await sql`
        select
            r.room_code as "roomCode",
            r.round_number::int as "roundNumber",
            coalesce(p.name, 'Unbekannt') as "creatorName",
            r.prompt,
            r.video_url as "videoUrl",
            r.round_points::int as "roundPoints",
            r.created_at::text as "createdAt"
        from rounds r
        left join players p
          on p.room_code = r.room_code
         and p.socket_id = r.creator_socket_id
        where r.video_url <> ''
        order by r.created_at desc
        limit 12
    `;

    return {
        overview: overview[0],
        players,
        recentVideos
    };
}
