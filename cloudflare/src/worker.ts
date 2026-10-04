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
}

interface DurableObjectState {
    storage: DurableObjectStorage;
}

interface CloudflareWebSocket extends WebSocket {
    accept(): void;
}

declare class WebSocketPair {
    0: CloudflareWebSocket;
    1: CloudflareWebSocket;
}

export interface Env {
    ASSETS: Fetcher;
    ROOMS: DurableObjectNamespace<RoomDurableObject>;
    HF_TOKEN?: string;
    DATABASE_URL?: string;
    AI_PROVIDER?: string;
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

type GameState = 'LOBBY' | 'IDLE' | 'GENERATING' | 'VOTING' | 'RESULTS' | 'GAME_OVER';
type ClientMessageType =
    | 'createRoom'
    | 'joinRoom'
    | 'resumeRoom'
    | 'leaveRoom'
    | 'startGame'
    | 'sendImage'
    | 'submitVote'
    | 'startNextRound';

interface ClientMessage {
    type: ClientMessageType;
    payload?: Record<string, unknown>;
}

interface Player {
    id: string;
    sessionId: string;
    name: string;
    score: number;
    connected: boolean;
}

interface RoomState {
    code: string;
    hostId: string;
    players: Player[];
    state: GameState;
    activeCreatorIndex: number;
    currentVotes: Record<string, number>;
    currentRound: number;
    maxRounds: number;
    currentPrompt: string;
    currentVideoUrl: string;
}

interface ConnectionMeta {
    socketId: string;
    sessionId: string;
}

const MIN_ROUNDS = 1;
const DEFAULT_AI_ROUND_LIMIT = 5;
const SOLO_PREVIEW_MS = 10000;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/api/config') {
            return json({
                aiRoundLimit: getAiRoundLimit(env),
                aiProvider: env.AI_PROVIDER || 'ltx',
                mockAi: env.AI_PROVIDER === 'mock',
                videoDuration: Number(env.LTX_DURATION || 5)
            });
        }

        if (url.pathname === '/api/stats') {
            return json({
                databaseEnabled: Boolean(env.DATABASE_URL),
                overview: {
                    gamesPlayed: 0,
                    completedGames: 0,
                    roundsPlayed: 0,
                    votesCast: 0,
                    videosArchived: 0,
                    highestScore: 0
                },
                players: [],
                recentVideos: [],
                videoStorageMode: 'url',
                migrationNote: 'Neon statistics persistence is implemented in the Node server and will be ported to the Worker in the next step.'
            });
        }

        if (url.pathname.startsWith('/ws/')) {
            const roomCode = sanitizeRoomId(url.pathname.replace('/ws/', ''));
            if (!roomCode) return new Response('Missing room code', { status: 400 });

            const id = env.ROOMS.idFromName(roomCode);
            const room = env.ROOMS.get(id);
            return room.fetch(request);
        }

        return env.ASSETS.fetch(request);
    }
};

export class RoomDurableObject {
    private state: DurableObjectState;
    private env: Env;
    private room: RoomState | null = null;
    private roomCode = 'ROOM';
    private sockets = new Map<CloudflareWebSocket, ConnectionMeta>();

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected WebSocket upgrade', { status: 426 });
        }

        this.roomCode = sanitizeRoomId(new URL(request.url).pathname.replace('/ws/', '')) || this.roomCode;
        await this.loadRoom();

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        const socketId = crypto.randomUUID();
        this.sockets.set(server, { socketId, sessionId: socketId });
        server.accept();
        this.send(server, 'connect', { socketId });

        server.addEventListener('message', event => {
            void this.handleMessage(server, socketId, event.data);
        });

        server.addEventListener('close', () => {
            this.disconnect(server);
        });

        server.addEventListener('error', () => {
            this.disconnect(server);
        });

        return new Response(null, {
            status: 101,
            webSocket: client
        } as ResponseInit & { webSocket: CloudflareWebSocket });
    }

    private async loadRoom() {
        if (this.room) return;
        this.room = (await this.state.storage.get<RoomState>('room')) || null;
    }

    private async saveRoom() {
        if (this.room) {
            await this.state.storage.put('room', this.room);
        } else {
            await this.state.storage.delete('room');
        }
    }

    private async handleMessage(socket: CloudflareWebSocket, socketId: string, data: unknown) {
        let message: ClientMessage;
        try {
            message = JSON.parse(String(data)) as ClientMessage;
        } catch {
            this.send(socket, 'errorMsg', 'Ungueltige Nachricht.');
            return;
        }

        const payload = message.payload || {};

        if (message.type === 'createRoom') {
            await this.createRoom(socket, socketId, payload);
        } else if (message.type === 'joinRoom') {
            await this.joinRoom(socket, socketId, payload);
        } else if (message.type === 'resumeRoom') {
            await this.resumeRoom(socket, socketId, payload);
        } else if (message.type === 'leaveRoom') {
            await this.leaveRoom(socket, socketId);
        } else if (message.type === 'startGame') {
            await this.startGame(socketId);
        } else if (message.type === 'sendImage') {
            await this.sendImage(socketId, payload);
        } else if (message.type === 'submitVote') {
            await this.submitVote(socketId, payload);
        } else if (message.type === 'startNextRound') {
            await this.startNextRound(socketId);
        }
    }

    private async createRoom(socket: CloudflareWebSocket, socketId: string, payload: Record<string, unknown>) {
        const username = sanitizeUsername(payload.username);
        if (!username) {
            this.send(socket, 'errorMsg', 'Bitte gib einen gueltigen Spielernamen ein!');
            return;
        }

        const sessionId = sanitizeSessionId(payload.sessionId) || socketId;
        this.room = {
            code: this.roomCode,
            hostId: socketId,
            players: [{ id: socketId, sessionId, name: username, score: 0, connected: true }],
            state: 'LOBBY',
            activeCreatorIndex: 0,
            currentVotes: {},
            currentRound: 1,
            maxRounds: sanitizeMaxRounds(payload.maxRounds, getAiRoundLimit(this.env)),
            currentPrompt: '',
            currentVideoUrl: ''
        };
        this.sockets.set(socket, { socketId, sessionId });

        await this.saveRoom();
        this.send(socket, 'roomCreated', { roomId: this.roomCode, sessionId });
        this.broadcastRoomUpdate();
    }

    private async joinRoom(socket: CloudflareWebSocket, socketId: string, payload: Record<string, unknown>) {
        const room = this.room;
        const username = sanitizeUsername(payload.username);
        const sessionId = sanitizeSessionId(payload.sessionId) || socketId;

        if (!room) {
            this.send(socket, 'errorMsg', 'Raum wurde nicht gefunden!');
            return;
        }

        if (!username) {
            this.send(socket, 'errorMsg', 'Bitte gib einen gueltigen Spielernamen ein!');
            return;
        }

        if (room.state !== 'LOBBY') {
            this.send(socket, 'errorMsg', 'Das Spiel laeuft bereits. Bitte warte auf die naechste Partie!');
            return;
        }

        room.players.push({ id: socketId, sessionId, name: username, score: 0, connected: true });
        this.sockets.set(socket, { socketId, sessionId });
        await this.saveRoom();
        this.send(socket, 'joinedSuccess', { roomId: room.code, sessionId });
        this.broadcastRoomUpdate();
    }

    private async resumeRoom(socket: CloudflareWebSocket, socketId: string, payload: Record<string, unknown>) {
        const room = this.room;
        const sessionId = sanitizeSessionId(payload.sessionId);
        if (!room || !sessionId) {
            this.send(socket, 'resumeFailed');
            return;
        }

        const player = room.players.find(item => item.sessionId === sessionId);
        if (!player) {
            this.send(socket, 'resumeFailed');
            return;
        }

        const oldSocketId = player.id;
        player.id = socketId;
        player.connected = true;
        if (room.hostId === oldSocketId) room.hostId = socketId;
        if (room.currentVotes[oldSocketId] !== undefined) {
            room.currentVotes[socketId] = room.currentVotes[oldSocketId];
            delete room.currentVotes[oldSocketId];
        }
        this.sockets.set(socket, { socketId, sessionId });

        await this.saveRoom();
        this.send(socket, 'resumeSuccess', { roomId: room.code, sessionId, gameState: room.state });
        this.broadcastRoomUpdate();
        this.restoreScreen(socket);
    }

    private async leaveRoom(socket: CloudflareWebSocket, socketId: string) {
        const room = this.room;
        if (!room) return;
        this.removePlayer(socketId);
        this.sockets.delete(socket);

        await this.saveRoom();
        this.send(socket, 'leftRoom');
        this.broadcastRoomUpdate();
        if (this.room?.state === 'IDLE') this.sendCreateScreenState();
        if (this.room?.state === 'VOTING') await this.checkVotingComplete();
    }

    private async startGame(socketId: string) {
        const room = this.room;
        if (!room || room.state !== 'LOBBY' || room.hostId !== socketId) return;

        room.state = 'IDLE';
        room.currentRound = 1;
        room.activeCreatorIndex = 0;
        room.currentVotes = {};
        room.players.forEach(player => {
            player.score = 0;
        });

        await this.saveRoom();
        this.broadcastRoomUpdate();
        this.sendCreateScreenState();
    }

    private async sendImage(socketId: string, payload: Record<string, unknown>) {
        const room = this.room;
        const prompt = sanitizePrompt(payload.prompt);
        if (!room || room.state !== 'IDLE') return;

        const activeCreator = this.getActiveCreator();
        if (!activeCreator || activeCreator.id !== socketId) {
            this.sendBySocketId(socketId, 'errorMsg', 'Du bist in dieser Runde nicht an der Reihe!');
            return;
        }

        if (!prompt || typeof payload.imageBase64 !== 'string') {
            this.sendBySocketId(socketId, 'errorMsg', 'Bitte lade ein Bild hoch und gib einen Prompt ein.');
            return;
        }

        room.state = 'GENERATING';
        room.currentVotes = {};
        room.currentPrompt = prompt;
        await this.saveRoom();
        this.broadcast('generationStarted', {
            authorName: activeCreator.name,
            step: this.env.AI_PROVIDER === 'mock' ? 'Mock-Video wird vorbereitet...' : 'LTX erstellt ein Video...'
        });

        try {
            const videoUrl = await this.generateVideo(String(payload.imageBase64), prompt);
            if (room.state !== 'GENERATING' || !room.players.some(player => player.id === activeCreator.id)) {
                return;
            }

            room.state = 'VOTING';
            room.currentVideoUrl = videoUrl;
            await this.saveRoom();
            this.broadcastRoomUpdate();
            this.broadcast('showVotingScreen', {
                videoUrl,
                authorId: activeCreator.id,
                authorName: activeCreator.name
            });

            const hasEligibleVoters = this.getConnectedPlayers().some(player => player.id !== activeCreator.id);
            if (hasEligibleVoters) {
                await this.checkVotingComplete();
            } else {
                setTimeout(() => {
                    void this.checkVotingComplete();
                }, SOLO_PREVIEW_MS);
            }
        } catch (error) {
            room.state = 'IDLE';
            await this.saveRoom();
            this.broadcastRoomUpdate();
            this.sendCreateScreenState();
            this.broadcast('errorMsg', error instanceof Error ? error.message : 'Generierung fehlgeschlagen. Bitte erneut versuchen!');
        }
    }

    private async submitVote(socketId: string, payload: Record<string, unknown>) {
        const room = this.room;
        if (!room || room.state !== 'VOTING') return;
        const activeCreator = this.getActiveCreator();
        if (activeCreator?.id === socketId) return;

        const points = Number(payload.points);
        if (!Number.isFinite(points)) return;
        room.currentVotes[socketId] = Math.min(Math.max(Math.floor(points), 1), 5);
        await this.saveRoom();
        await this.checkVotingComplete();
    }

    private async startNextRound(socketId: string) {
        const room = this.room;
        if (!room || room.state !== 'RESULTS' || room.hostId !== socketId) return;

        room.activeCreatorIndex = (room.activeCreatorIndex + 1) % room.players.length;
        room.currentRound += 1;
        room.state = 'IDLE';
        room.currentVotes = {};
        room.currentPrompt = '';
        room.currentVideoUrl = '';
        await this.saveRoom();
        this.broadcastRoomUpdate();
        this.sendCreateScreenState();
    }

    private async checkVotingComplete() {
        const room = this.room;
        if (!room || room.state !== 'VOTING') return;
        const activeCreator = this.getActiveCreator();
        if (!activeCreator) return;

        const eligibleVoters = this.getConnectedPlayers().filter(player => player.id !== activeCreator.id);
        const votesCount = Object.keys(room.currentVotes).length;
        if (votesCount < eligibleVoters.length) {
            this.broadcast('voteProgress', { voted: votesCount, total: eligibleVoters.length });
            return;
        }

        const roundPoints = Object.values(room.currentVotes).reduce((sum, points) => sum + points, 0);
        activeCreator.score += roundPoints;
        room.state = 'RESULTS';
        await this.saveRoom();
        this.broadcastRoomUpdate();
        this.broadcast('showResultsScreen', {
            authorName: activeCreator.name,
            roundPoints,
            players: room.players,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            isFinalRound: room.currentRound >= room.maxRounds
        });

        if (room.currentRound >= room.maxRounds) {
            room.state = 'GAME_OVER';
            await this.saveRoom();
            this.broadcast('showGameOverScreen', {
                players: [...room.players].sort((a, b) => b.score - a.score),
                maxRounds: room.maxRounds
            });
        }
    }

    private disconnect(socket: CloudflareWebSocket) {
        const meta = this.sockets.get(socket);
        const room = this.room;
        if (!meta || !room) return;

        const player = room.players.find(item => item.id === meta.socketId);
        if (player) player.connected = false;
        this.sockets.delete(socket);
        void this.saveRoom();
        this.broadcastRoomUpdate();
    }

    private removePlayer(socketId: string) {
        const room = this.room;
        if (!room) return;

        const index = room.players.findIndex(player => player.id === socketId);
        if (index === -1) return;

        const wasActive = room.activeCreatorIndex === index;
        room.players.splice(index, 1);
        delete room.currentVotes[socketId];

        if (room.players.length === 0) {
            this.room = null;
            return;
        }

        if (room.hostId === socketId) room.hostId = room.players[0].id;
        if (room.activeCreatorIndex >= room.players.length) room.activeCreatorIndex = 0;

        if (wasActive && (room.state === 'IDLE' || room.state === 'GENERATING' || room.state === 'VOTING')) {
            room.state = 'IDLE';
            room.currentVotes = {};
            room.currentPrompt = '';
            room.currentVideoUrl = '';
            this.broadcast('roomNotice', 'Der aktive Spieler hat das Spiel verlassen. Der naechste Spieler ist an der Reihe.');
        } else if (room.state === 'VOTING') {
            this.broadcast('roomNotice', 'Ein Spieler hat das Spiel verlassen.');
        }
    }

    private restoreScreen(socket: CloudflareWebSocket) {
        const room = this.room;
        if (!room) return;
        if (room.state === 'IDLE' || room.state === 'GENERATING') {
            this.sendCreateScreenState();
        } else if (room.state === 'VOTING') {
            const creator = this.getActiveCreator();
            this.send(socket, 'showVotingScreen', {
                videoUrl: room.currentVideoUrl,
                authorId: creator?.id,
                authorName: creator?.name || 'Spieler'
            });
        } else if (room.state === 'GAME_OVER') {
            this.send(socket, 'showGameOverScreen', {
                players: [...room.players].sort((a, b) => b.score - a.score),
                maxRounds: room.maxRounds
            });
        }
    }

    private sendCreateScreenState() {
        const room = this.room;
        const activeCreator = this.getActiveCreator();
        if (!room || !activeCreator) return;
        this.broadcast('showCreateScreen', {
            activeCreatorId: activeCreator.id,
            activeCreatorName: activeCreator.name,
            hostId: room.hostId
        });
    }

    private broadcastRoomUpdate() {
        const room = this.room;
        if (!room) return;
        this.broadcast('roomDataUpdate', {
            playerCount: this.getConnectedPlayers().length,
            players: room.players,
            hostId: room.hostId,
            gameState: room.state,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds
        });
    }

    private getActiveCreator() {
        const room = this.room;
        if (!room || this.getConnectedPlayers().length === 0) return undefined;
        if (room.activeCreatorIndex >= room.players.length) room.activeCreatorIndex = 0;
        while (room.players[room.activeCreatorIndex] && !room.players[room.activeCreatorIndex].connected) {
            room.activeCreatorIndex = (room.activeCreatorIndex + 1) % room.players.length;
        }
        return room.players[room.activeCreatorIndex];
    }

    private getConnectedPlayers() {
        return this.room?.players.filter(player => player.connected) || [];
    }

    private async generateVideo(imageBase64: string, prompt: string) {
        if (this.env.AI_PROVIDER === 'mock') return '/assets/mock-video.mp4';

        return this.generateLtxVideo(imageBase64, prompt);
    }

    private async generateLtxVideo(imageBase64: string, prompt: string) {
        const space = this.env.HF_SPACE_ID || 'Lightricks/ltx-video-distilled';
        const endpoint = this.env.HF_PREDICT_ENDPOINT || '/image_to_video';
        const root = `https://${space.toLowerCase().replace('/', '-')}.hf.space`;
        const token = this.env.HF_TOKEN;
        const file = makeFileData(imageBase64);
        const uploadResponse = await fetch(`${root}/gradio_api/upload`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: file.formData
        });

        if (!uploadResponse.ok) {
            throw new Error('Bild konnte nicht zu Hugging Face hochgeladen werden.');
        }

        const uploaded = await uploadResponse.json() as { path?: string }[] | string[];
        const uploadedPath = Array.isArray(uploaded) ? (typeof uploaded[0] === 'string' ? uploaded[0] : uploaded[0]?.path) : undefined;
        if (!uploadedPath) {
            throw new Error('Hugging Face hat keinen Upload-Pfad zurueckgegeben.');
        }

        const fileData = {
            path: uploadedPath,
            url: `${root}/gradio_api/file=${uploadedPath}`,
            orig_name: file.name,
            mime_type: file.mimeType,
            meta: { _type: 'gradio.FileData' }
        };

        const result = await callGradioPredict(root, endpoint, token, [
            buildVideoPrompt(prompt),
            getNegativePrompt(),
            fileData,
            null,
            Number(this.env.LTX_HEIGHT || 512),
            Number(this.env.LTX_WIDTH || 704),
            'image-to-video',
            Number(this.env.LTX_DURATION || 5),
            Number(this.env.LTX_FRAMES || 121),
            createVideoSeed(),
            false,
            Number(this.env.LTX_GUIDANCE || 2.5),
            this.env.LTX_ENHANCE_PROMPT === 'true'
        ]);

        return extractVideoUrl(result);
    }

    private broadcast(type: string, payload?: unknown) {
        for (const socket of this.sockets.keys()) {
            this.send(socket, type, payload);
        }
    }

    private sendBySocketId(socketId: string, type: string, payload?: unknown) {
        for (const [socket, meta] of this.sockets.entries()) {
            if (meta.socketId === socketId) {
                this.send(socket, type, payload);
            }
        }
    }

    private send(socket: CloudflareWebSocket, type: string, payload?: unknown) {
        try {
            socket.send(JSON.stringify({ type, payload }));
        } catch {
            this.sockets.delete(socket);
        }
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

function getAiRoundLimit(env: Env) {
    const parsed = Number(env.AI_ROUND_LIMIT);
    return Number.isFinite(parsed) ? Math.max(Math.floor(parsed), MIN_ROUNDS) : DEFAULT_AI_ROUND_LIMIT;
}

function sanitizeUsername(username: unknown): string {
    return typeof username === 'string' ? username.trim().slice(0, 15) : '';
}

function sanitizeRoomId(roomId: unknown): string {
    return typeof roomId === 'string' ? roomId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : '';
}

function sanitizePrompt(prompt: unknown): string {
    return typeof prompt === 'string' ? prompt.trim().slice(0, 150) : '';
}

function sanitizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : '';
}

function sanitizeMaxRounds(value: unknown, aiRoundLimit: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return aiRoundLimit;
    return Math.min(Math.max(Math.floor(parsed), MIN_ROUNDS), aiRoundLimit);
}

function buildVideoPrompt(prompt: string) {
    return [
        `Action to animate: ${prompt}.`,
        'The visible main subject performs this action clearly on screen.',
        'Move the subject and relevant objects in the image; do not use only camera movement.',
        'Keep the original person, object, scene, and style recognizable.',
        'Use a mostly static camera unless the user explicitly requests camera movement.'
    ].join(' ');
}

function getNegativePrompt() {
    return 'worst quality, inconsistent motion, blurry, jittery, distorted, static, frozen, motionless subject, camera pan only, zoom only, no action, bad anatomy, warped body, extra limbs, deformed face, flickering, low quality';
}

function createVideoSeed() {
    return Math.floor(Math.random() * 2_147_483_647);
}

function makeFileData(imageBase64: string) {
    const [metadata, payload] = imageBase64.split(',');
    const mimeType = metadata?.split(';')[0]?.split(':')[1] || 'image/png';
    const bytes = Uint8Array.from(atob(payload || ''), char => char.charCodeAt(0));
    const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
    const name = `input.${extension}`;
    const formData = new FormData();
    formData.append('files', new Blob([bytes], { type: mimeType }), name);
    return { formData, mimeType, name };
}

async function callGradioPredict(root: string, endpoint: string, token: string | undefined, data: unknown[]) {
    const apiEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const response = await fetch(`${root}/gradio_api/call${apiEndpoint}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ data })
    });

    if (!response.ok) {
        throw new Error('Hugging Face konnte die Video-Generierung nicht starten.');
    }

    const started = await response.json() as { event_id?: string };
    if (!started.event_id) {
        throw new Error('Hugging Face hat keine Event-ID zurueckgegeben.');
    }

    const resultResponse = await fetch(`${root}/gradio_api/call${apiEndpoint}/${started.event_id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!resultResponse.ok) {
        throw new Error('Hugging Face konnte das Video-Ergebnis nicht liefern.');
    }

    return parseServerSentResult(await resultResponse.text());
}

function parseServerSentResult(body: string) {
    const eventBlocks = body.split('\n\n');
    for (const block of eventBlocks.reverse()) {
        const dataLine = block.split('\n').find(line => line.startsWith('data: '));
        if (!dataLine) continue;
        const data = dataLine.slice('data: '.length);
        if (!data || data === 'null') continue;
        try {
            return { data: JSON.parse(data) };
        } catch {
            // Continue until a parseable data event is found.
        }
    }
    throw new Error('Hugging Face hat kein auswertbares Video-Ergebnis geliefert.');
}

function extractVideoUrl(result: any): string {
    const videoData = result?.data?.[0] ?? result;
    const url = videoData?.video?.url || videoData?.url || videoData?.path || videoData;

    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('KI hat keine Video-URL zurueckgegeben.');
    }

    return url;
}
