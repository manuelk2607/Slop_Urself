import { authDisabled, requestAccount, verifyAccountToken } from '../../auth/session';
import { getDatabase } from '../../database/neon';
import { roundInput } from '../../game/persistence';
import { generateAiVideo, resumeAiVideo, AiPendingError, AiExpiredError, AI_RETRY_MS, validateImage } from '../../ai/generation';
import { logAiEvent } from '../../ai/telemetry';
import { takeRateLimit, MESSAGE_RATE, RATE_MESSAGE, type RateBuckets } from '../../security/rate-limit';
import { type QuotaCapacity } from '../../ai/quota';
import { type Room as RoomState, type Player, activeCreator, playerForConnection, roomSnapshot, finalStandings, removePlayer, finishVoting, sanitizeUsername, sanitizeRoomId, sanitizeSessionId, maxRounds, DISCONNECT_GRACE_MS, SOLO_PREVIEW_MS, startRounds, advanceTurn, remainingVideos, extendRound } from '../../game/rules';
import { service } from './runtime';
import type { DurableObjectState, CloudflareWebSocket, ConnectionMeta, Env, PendingRoomWrite } from './types';

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
        const database = getDatabase(this.env.DATABASE_URL);
        if (this.room || await database?.roomExists(this.roomCode)) {
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
            const database = getDatabase(this.env.DATABASE_URL);
            await database?.saveRoom(room.code, room.hostId, room.maxRounds);
            await database?.saveScores(room.code, room.players, room.hostId);
            if (room.state !== 'LOBBY') await database?.markRoomStarted(room.code);
        } catch (error) {
            console.error('[DB] Members not saved', error instanceof Error ? error.message : 'Database error');
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
