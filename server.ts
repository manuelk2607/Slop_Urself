import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import { Server, Socket } from 'socket.io';
import { Client, prepare_files } from '@gradio/client';

dotenv.config({ path: '.env.local' });
dotenv.config();

import {
    ensureDatabaseSchema,
    getStats,
    isDatabaseEnabled,
    markRoomFinished,
    markRoomStarted,
    savePlayer,
    saveRoom,
    saveRound,
    saveScores
} from './db';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PUBLIC_ROOT = path.join(__dirname, '..');

app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_ROOT, 'index.html'));
});
app.get('/style.css', (_req, res) => {
    res.sendFile(path.join(PUBLIC_ROOT, 'style.css'));
});
app.get('/script.js', (_req, res) => {
    res.sendFile(path.join(__dirname, 'script.js'));
});
app.use('/assets', express.static(path.join(PUBLIC_ROOT, 'assets')));

const HF_TOKEN = process.env.HF_TOKEN;
const PORT = Number(process.env.PORT) || 3000;
const MIN_ROUNDS = 1;
const AI_ROUND_LIMIT = Math.max(Number(process.env.AI_ROUND_LIMIT) || 5, MIN_ROUNDS);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SOLO_PREVIEW_MS = 10000;
type AiProvider = 'mock' | 'ltx' | 'wan';
const AI_PROVIDER = parseAiProvider(process.env.AI_PROVIDER ?? (process.env.USE_MOCK_AI === 'true' ? 'mock' : 'ltx'));
const HF_SPACE_ID = process.env.HF_SPACE_ID || 'Lightricks/ltx-video-distilled';
const HF_PREDICT_ENDPOINT = process.env.HF_PREDICT_ENDPOINT || '/image_to_video';
const HF_SPACE_ROOT = `https://${HF_SPACE_ID.toLowerCase().replace('/', '-')}.hf.space`;
const LTX_HEIGHT = clampNumber(process.env.LTX_HEIGHT, 256, 1280, 512);
const LTX_WIDTH = clampNumber(process.env.LTX_WIDTH, 256, 1280, 704);
const LTX_DURATION = clampNumber(process.env.LTX_DURATION, 0.3, 8.5, 5);
const LTX_FRAMES = clampNumber(process.env.LTX_FRAMES, 9, 257, 121);
const LTX_GUIDANCE = clampNumber(process.env.LTX_GUIDANCE, 1, 10, 3.5);
const LTX_NEGATIVE_PROMPT = process.env.LTX_NEGATIVE_PROMPT
    || 'worst quality, inconsistent motion, blurry, jittery, distorted, static, frozen, motionless subject, camera pan only, zoom only, no action, bad anatomy, warped body, extra limbs, deformed face, flickering, low quality';

interface Player {
    id: string;
    sessionId: string;
    name: string;
    score: number;
    connected: boolean;
}

type GameState = 'LOBBY' | 'IDLE' | 'GENERATING' | 'VOTING' | 'RESULTS' | 'GAME_OVER';

interface Room {
    hostId: string;
    players: Player[];
    state: GameState;
    activeCreatorIndex: number; // Index des Spielers, der aktuell an der Reihe ist
    currentVotes: Record<string, number>;
    currentRound: number;
    maxRounds: number;
    currentPrompt: string;
    currentVideoUrl: string;
    disconnectTimers: Record<string, NodeJS.Timeout>;
}

const rooms: Record<string, Room> = {};

function parseAiProvider(value: string): AiProvider {
    if (value === 'ltx' || value === 'wan') return value;
    return 'mock';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
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

function sanitizeMaxRounds(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 5;
    return Math.min(Math.max(Math.floor(parsed), MIN_ROUNDS), AI_ROUND_LIMIT);
}

function createRoomId(): string {
    let roomId = '';
    do {
        roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms[roomId]);
    return roomId;
}

function getRoomForSocket(roomId: unknown, socketId: string): { roomId: string; room?: Room } {
    const formattedRoomId = sanitizeRoomId(roomId);
    const room = formattedRoomId ? rooms[formattedRoomId] : undefined;
    if (!room || !room.players.some(player => player.id === socketId)) {
        return { roomId: formattedRoomId };
    }
    return { roomId: formattedRoomId, room };
}

function getPlayerBySocket(room: Room, socketId: string) {
    return room.players.find(player => player.id === socketId);
}

function getConnectedPlayers(room: Room) {
    return room.players.filter(player => player.connected);
}

function broadcastRoomUpdate(roomId: string) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('roomDataUpdate', {
        playerCount: getConnectedPlayers(room).length,
        players: room.players,
        hostId: room.hostId,
        gameState: room.state,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds
    });
}

function logPersistenceError(action: string, error: unknown) {
    console.error(`[DB] ${action} fehlgeschlagen:`, error);
}

function getActiveCreator(room: Room): Player | undefined {
    const connectedPlayers = getConnectedPlayers(room);
    if (connectedPlayers.length === 0) return undefined;
    if (room.activeCreatorIndex >= room.players.length) {
        room.activeCreatorIndex = 0;
    }
    while (room.players[room.activeCreatorIndex] && !room.players[room.activeCreatorIndex].connected) {
        room.activeCreatorIndex = (room.activeCreatorIndex + 1) % room.players.length;
    }
    return room.players[room.activeCreatorIndex];
}

function sendCreateScreenState(roomId: string) {
    const room = rooms[roomId];
    if (!room) return;
    const activeCreator = getActiveCreator(room);
    if (!activeCreator) return;

    io.to(roomId).emit('showCreateScreen', {
        activeCreatorId: activeCreator.id,
        activeCreatorName: activeCreator.name,
        hostId: room.hostId
    });
}

function emitRoomNotice(roomId: string, message: string) {
    io.to(roomId).emit('roomNotice', message);
}

function getHfClientOptions() {
    return HF_TOKEN ? { token: HF_TOKEN as `hf_${string}` } : undefined;
}

function getImageFile(imageBase64: string) {
    const base64Data = imageBase64.split(',')[1];
    const mimeType = imageBase64.split(';')[0].split(':')[1] || 'image/png';
    const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);

    if (estimatedBytes > MAX_IMAGE_BYTES) {
        throw new Error('IMAGE_TOO_LARGE');
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
    return new File([buffer], `input.${extension}`, { type: mimeType });
}

function extractVideoUrl(result: any): string {
    const videoData = result?.data?.[0] ?? result;
    const url = videoData?.video?.url || videoData?.url || videoData?.path || videoData;

    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('KI hat keine Video-URL zurueckgegeben.');
    }

    return url;
}

function buildVideoPrompt(prompt: string) {
    return [
        `Primary action: ${prompt}.`,
        'The main subject must visibly perform the primary action during the clip.',
        'Animate the subject, body, limbs, clothing, water, props, and nearby environment as needed to make the action clear.',
        'Do not replace the requested action with only a camera pan, zoom, or still-image drift.',
        'Preserve the uploaded image identity and setting, but prioritize executing the requested action over perfectly freezing the original composition.',
        'Use a stable or gently following camera only if it helps show the action.',
        'Make the result coherent, playful, and easy to understand in a five-second party-game clip.'
    ].join(' ');
}

async function generateMockVideo() {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return '/assets/mock-video.mp4';
}

async function generateLtxVideo(imageFile: File, prompt: string) {
    const client = await Client.connect(HF_SPACE_ID, getHfClientOptions());
    const uploadedFiles = await client.upload(await prepare_files([imageFile]), HF_SPACE_ROOT);
    const uploadedImage = uploadedFiles?.[0];

    if (!uploadedImage) {
        throw new Error('Bild konnte nicht zu Hugging Face hochgeladen werden.');
    }

    const videoPrompt = buildVideoPrompt(prompt);
    const result = await client.predict(HF_PREDICT_ENDPOINT, [
        videoPrompt,
        LTX_NEGATIVE_PROMPT,
        uploadedImage,
        null,
        LTX_HEIGHT,
        LTX_WIDTH,
        'image-to-video',
        LTX_DURATION,
        LTX_FRAMES,
        42,
        true,
        LTX_GUIDANCE,
        true
    ]) as any;

    return extractVideoUrl(result);
}

async function generateWanVideo(imageFile: File, prompt: string) {
    const client = await Client.connect(HF_SPACE_ID, getHfClientOptions());
    const uploadedFiles = await client.upload(await prepare_files([imageFile]), HF_SPACE_ROOT);
    const uploadedImage = uploadedFiles?.[0];

    if (!uploadedImage) {
        throw new Error('Bild konnte nicht zu Hugging Face hochgeladen werden.');
    }

    const result = await client.predict(HF_PREDICT_ENDPOINT, [
        uploadedImage,
        prompt,
        'blurry, low quality, distorted, static, motionless',
        42,
        true
    ]) as any;

    return extractVideoUrl(result);
}

async function generateAiVideo(imageBase64: string, prompt: string) {
    if (AI_PROVIDER === 'mock') {
        return generateMockVideo();
    }

    const imageFile = getImageFile(imageBase64);
    if (AI_PROVIDER === 'wan') {
        return generateWanVideo(imageFile, prompt);
    }

    return generateLtxVideo(imageFile, prompt);
}

async function persistFinishedRound(roomId: string, room: Room, activeCreator: Player, totalRoundPoints: number) {
    try {
        await saveScores(roomId, room.players, room.hostId);
        await saveRound({
            roomCode: roomId,
            roundNumber: room.currentRound,
            creatorSocketId: activeCreator.id,
            prompt: room.currentPrompt,
            videoUrl: room.currentVideoUrl,
            roundPoints: totalRoundPoints,
            votes: Object.entries(room.currentVotes).map(([voterSocketId, points]) => ({
                voterSocketId,
                points
            }))
        });
    } catch (error) {
        logPersistenceError('Runde speichern', error);
    }
}

async function checkVotingComplete(roomId: string) {
    const room = rooms[roomId];
    if (!room || room.state !== 'VOTING') return;

    const activeCreator = getActiveCreator(room);
    if (!activeCreator) return;

    const eligibleVoters = getConnectedPlayers(room).filter(p => p.id !== activeCreator.id);
    const votesCount = Object.keys(room.currentVotes).length;

    // Wenn alle anderen abgestimmt haben (oder man alleine testet)
    if (votesCount >= eligibleVoters.length || eligibleVoters.length === 0) {
        let totalRoundPoints = 0;
        for (const pts of Object.values(room.currentVotes)) {
            totalRoundPoints += pts;
        }

        activeCreator.score += totalRoundPoints;
        await persistFinishedRound(roomId, room, activeCreator, totalRoundPoints);
        room.state = 'RESULTS';
        broadcastRoomUpdate(roomId);

        io.to(roomId).emit('showResultsScreen', {
            authorName: activeCreator.name,
            roundPoints: totalRoundPoints,
            players: room.players,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            isFinalRound: room.currentRound >= room.maxRounds
        });

        if (room.currentRound >= room.maxRounds) {
            room.state = 'GAME_OVER';
            const finalStandings = [...room.players]
                .sort((a, b) => b.score - a.score)
                .map((player, index) => ({
                    playerSocketId: player.id,
                    name: player.name,
                    score: player.score,
                    finalRank: index + 1
                }));
            try {
                await saveScores(roomId, room.players, room.hostId);
                await markRoomFinished(roomId, finalStandings);
            } catch (error) {
                logPersistenceError('Raum abschliessen', error);
            }
            broadcastRoomUpdate(roomId);
            io.to(roomId).emit('showGameOverScreen', {
                players: [...room.players].sort((a, b) => b.score - a.score),
                maxRounds: room.maxRounds
            });
        }
    } else {
        io.to(roomId).emit('voteProgress', {
            voted: votesCount,
            total: eligibleVoters.length
        });
    }
}

function removePlayerFromRoom(roomId: string, socketId: string, announce = true) {
    const room = rooms[roomId];
    if (!room) return;

    const index = room.players.findIndex(p => p.id === socketId);
    if (index === -1) return;

    const wasActive = room.activeCreatorIndex === index;
    const removedPlayer = room.players[index];
    if (room.disconnectTimers[removedPlayer.sessionId]) {
        clearTimeout(room.disconnectTimers[removedPlayer.sessionId]);
        delete room.disconnectTimers[removedPlayer.sessionId];
    }

    room.players.splice(index, 1);
    delete room.currentVotes[socketId];

    if (room.players.length === 0) {
        delete rooms[roomId];
        return;
    }

    if (room.hostId === socketId) {
        const nextHost = getConnectedPlayers(room)[0] ?? room.players[0];
        room.hostId = nextHost.id;
        if (announce) emitRoomNotice(roomId, `${removedPlayer.name} hat den Raum verlassen. ${nextHost.name} ist jetzt Host.`);
    } else if (announce) {
        emitRoomNotice(roomId, `${removedPlayer.name} hat den Raum verlassen.`);
    }

    if (room.activeCreatorIndex >= room.players.length) {
        room.activeCreatorIndex = 0;
    }

    if (wasActive && (room.state === 'IDLE' || room.state === 'GENERATING' || room.state === 'VOTING')) {
        room.state = 'IDLE';
        room.currentVotes = {};
        room.currentPrompt = '';
        room.currentVideoUrl = '';
        broadcastRoomUpdate(roomId);
        sendCreateScreenState(roomId);
        emitRoomNotice(roomId, 'Der aktive Spieler hat das Spiel verlassen. Der nächste Spieler ist an der Reihe.');
    } else if (room.state === 'VOTING') {
        void checkVotingComplete(roomId);
        broadcastRoomUpdate(roomId);
    } else {
        broadcastRoomUpdate(roomId);
        if (room.state === 'IDLE') {
            sendCreateScreenState(roomId);
        }
    }
}

app.get('/api/stats', async (_req, res) => {
    try {
        const stats = await getStats();
        res.json({
            databaseEnabled: isDatabaseEnabled(),
            ...stats,
            videoStorageMode: 'url'
        });
    } catch (error) {
        console.error('[DB] Statistiken laden fehlgeschlagen:', error);
        res.status(500).json({ error: 'Statistiken konnten nicht geladen werden.' });
    }
});

app.get('/api/config', (_req, res) => {
    res.json({
        aiRoundLimit: AI_ROUND_LIMIT,
        aiProvider: AI_PROVIDER,
        mockAi: AI_PROVIDER === 'mock',
        videoDuration: LTX_DURATION
    });
});

io.on('connection', (socket: Socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);

    // 1. RAUM ERSTELLEN
    socket.on('createRoom', async (data: { username: string; maxRounds?: number; sessionId?: string }) => {
        const username = sanitizeUsername(data?.username);
        const sessionId = sanitizeSessionId(data?.sessionId) || socket.id;
        if (!username) {
            socket.emit('errorMsg', 'Bitte gib einen gültigen Spielernamen ein!');
            return;
        }

        const roomId = createRoomId();
        rooms[roomId] = {
            hostId: socket.id,
            players: [{ id: socket.id, sessionId, name: username, score: 0, connected: true }],
            state: 'LOBBY',
            activeCreatorIndex: 0,
            currentVotes: {},
            currentRound: 1,
            maxRounds: sanitizeMaxRounds(data?.maxRounds),
            currentPrompt: '',
            currentVideoUrl: '',
            disconnectTimers: {}
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, sessionId });
        broadcastRoomUpdate(roomId);

        try {
            await saveRoom(roomId, socket.id, rooms[roomId].maxRounds);
            await savePlayer({
                roomCode: roomId,
                playerSocketId: socket.id,
                name: username,
                score: 0,
                isHost: true
            });
        } catch (error) {
            logPersistenceError('Raum erstellen speichern', error);
        }
    });

    // 2. RAUM BEITRETEN
    socket.on('joinRoom', async (data: { roomId: string; username: string; sessionId?: string }) => {
        const formattedRoomId = sanitizeRoomId(data?.roomId);
        const username = sanitizeUsername(data?.username);
        const sessionId = sanitizeSessionId(data?.sessionId) || socket.id;
        const room = rooms[formattedRoomId];

        if (!username) {
            socket.emit('errorMsg', 'Bitte gib einen gültigen Spielernamen ein!');
            return;
        }

        if (!room) {
            socket.emit('errorMsg', 'Raum wurde nicht gefunden!');
            return;
        }

        if (room.state === 'GAME_OVER') {
            socket.emit('errorMsg', 'Dieses Spiel ist bereits beendet!');
            return;
        }

        if (room.state !== 'LOBBY') {
            socket.emit('errorMsg', 'Das Spiel läuft bereits. Bitte warte auf die nächste Partie!');
            return;
        }

        if (room.players.some(player => player.id === socket.id)) {
            socket.emit('errorMsg', 'Du bist bereits in diesem Raum!');
            return;
        }

        room.players.push({ id: socket.id, sessionId, name: username, score: 0, connected: true });
        socket.join(formattedRoomId);
        socket.emit('joinedSuccess', { roomId: formattedRoomId, sessionId });
        broadcastRoomUpdate(formattedRoomId);

        try {
            await savePlayer({
                roomCode: formattedRoomId,
                playerSocketId: socket.id,
                name: username,
                score: 0,
                isHost: false
            });
        } catch (error) {
            logPersistenceError('Spieler speichern', error);
        }
    });

    socket.on('resumeRoom', (data: { roomId: string; sessionId: string }) => {
        const formattedRoomId = sanitizeRoomId(data?.roomId);
        const sessionId = sanitizeSessionId(data?.sessionId);
        const room = rooms[formattedRoomId];

        if (!room || !sessionId) {
            socket.emit('resumeFailed');
            return;
        }

        const player = room.players.find(p => p.sessionId === sessionId);
        if (!player) {
            socket.emit('resumeFailed');
            return;
        }

        if (room.disconnectTimers[sessionId]) {
            clearTimeout(room.disconnectTimers[sessionId]);
            delete room.disconnectTimers[sessionId];
        }

        const oldSocketId = player.id;
        player.id = socket.id;
        player.connected = true;
        if (room.hostId === oldSocketId) room.hostId = socket.id;
        if (room.currentVotes[oldSocketId] !== undefined) {
            room.currentVotes[socket.id] = room.currentVotes[oldSocketId];
            delete room.currentVotes[oldSocketId];
        }

        socket.join(formattedRoomId);
        socket.emit('resumeSuccess', {
            roomId: formattedRoomId,
            sessionId,
            gameState: room.state
        });
        broadcastRoomUpdate(formattedRoomId);
        emitRoomNotice(formattedRoomId, `${player.name} ist wieder verbunden.`);

        if (room.state === 'LOBBY') return;
        if (room.state === 'IDLE' || room.state === 'GENERATING') {
            sendCreateScreenState(formattedRoomId);
        } else if (room.state === 'VOTING') {
            socket.emit('showVotingScreen', {
                videoUrl: room.currentVideoUrl,
                authorId: getActiveCreator(room)?.id,
                authorName: getActiveCreator(room)?.name ?? 'Spieler'
            });
            void checkVotingComplete(formattedRoomId);
        } else if (room.state === 'RESULTS') {
            socket.emit('showResultsScreen', {
                authorName: getActiveCreator(room)?.name ?? 'Spieler',
                roundPoints: 0,
                players: room.players,
                currentRound: room.currentRound,
                maxRounds: room.maxRounds,
                isFinalRound: room.currentRound >= room.maxRounds
            });
        } else if (room.state === 'GAME_OVER') {
            socket.emit('showGameOverScreen', {
                players: [...room.players].sort((a, b) => b.score - a.score),
                maxRounds: room.maxRounds
            });
        }
    });

    socket.on('leaveRoom', (data: { roomId: string }) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data?.roomId, socket.id);
        if (!room) return;

        socket.leave(formattedRoomId);
        removePlayerFromRoom(formattedRoomId, socket.id);
        socket.emit('leftRoom');
    });

    // 3. SPIEL STARTEN (NUR HOST)
    socket.on('startGame', async (data: { roomId: string }) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data?.roomId, socket.id);

        if (!room || room.state !== 'LOBBY') return;
        if (room.hostId !== socket.id) {
            socket.emit('errorMsg', 'Nur der Host kann das Spiel starten!');
            return;
        }

        room.state = 'IDLE';
        room.currentRound = 1;
        room.activeCreatorIndex = 0;
        room.currentVotes = {};
        room.players.forEach(player => {
            player.score = 0;
        });
        room.currentPrompt = '';
        room.currentVideoUrl = '';

        broadcastRoomUpdate(formattedRoomId);
        sendCreateScreenState(formattedRoomId);

        try {
            await markRoomStarted(formattedRoomId);
            await saveScores(formattedRoomId, room.players, room.hostId);
        } catch (error) {
            logPersistenceError('Spielstart speichern', error);
        }
    });

    // 4. KI-GENERIERUNG (NUR FÜR DEN AKTIVEN SPIELER ERLAUBT)
    socket.on('sendImage', async (data: { roomId: string; imageBase64: string; prompt: string }) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data?.roomId, socket.id);
        const prompt = sanitizePrompt(data?.prompt);

        if (!room || room.state !== 'IDLE') return;
        if (!prompt) {
            socket.emit('errorMsg', 'Bitte gib eine gültige Anweisung ein!');
            return;
        }

        if (typeof data?.imageBase64 !== 'string' || !data.imageBase64.startsWith('data:image/')) {
            socket.emit('errorMsg', 'Bitte lade ein gültiges Bild hoch!');
            return;
        }

        const activeCreator = getActiveCreator(room);
        if (!activeCreator || activeCreator.id !== socket.id) {
            socket.emit('errorMsg', 'Du bist in dieser Runde nicht an der Reihe!');
            return;
        }

        room.state = 'GENERATING';
        room.currentVotes = {};
        room.currentPrompt = prompt;
        room.currentVideoUrl = '';

        io.to(formattedRoomId).emit('generationStarted', {
            authorName: activeCreator.name,
            step: AI_PROVIDER === 'mock' ? 'Mock-Video wird vorbereitet...' : `${AI_PROVIDER.toUpperCase()} erstellt ein Video...`
        });

        try {
            const generatedVideoUrl = await generateAiVideo(data.imageBase64, prompt);
            if (!rooms[formattedRoomId] || room.state !== 'GENERATING' || !room.players.some(player => player.id === activeCreator.id)) {
                return;
            }

            room.state = 'VOTING';
            room.currentVideoUrl = generatedVideoUrl;
            broadcastRoomUpdate(formattedRoomId);

            io.to(formattedRoomId).emit('showVotingScreen', {
                videoUrl: generatedVideoUrl,
                authorId: activeCreator.id,
                authorName: activeCreator.name
            });

            const hasEligibleVoters = getConnectedPlayers(room).some(player => player.id !== activeCreator.id);
            if (hasEligibleVoters) {
                void checkVotingComplete(formattedRoomId);
            } else {
                setTimeout(() => {
                    void checkVotingComplete(formattedRoomId);
                }, SOLO_PREVIEW_MS);
            }

        } catch (error) {
            console.error("Fehler in Pipeline:", error);
            room.state = 'IDLE';
            broadcastRoomUpdate(formattedRoomId);
            sendCreateScreenState(formattedRoomId);
            const message = error instanceof Error && error.message === 'IMAGE_TOO_LARGE'
                ? 'Das Bild ist zu groß. Bitte nutze maximal 8 MB.'
                : 'Generierung fehlgeschlagen. Bitte erneut versuchen!';
            io.to(formattedRoomId).emit('errorMsg', message);
        }
    });

    // 5. BEWERTUNG EMPFANGEN
    socket.on('submitVote', (data: { roomId: string; points: number }) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data?.roomId, socket.id);

        if (!room || room.state !== 'VOTING') return;
        const activeCreator = getActiveCreator(room);
        if (activeCreator && socket.id === activeCreator.id) return; // Ersteller darf nicht für sich selbst stimmen

        const points = Number(data?.points);
        if (!Number.isFinite(points)) return;

        room.currentVotes[socket.id] = Math.min(Math.max(Math.floor(points), 1), 5);
        void checkVotingComplete(formattedRoomId);
    });

    // 6. NÄCHSTE RUNDE STARTEN (ROTATION)
    socket.on('startNextRound', (data: { roomId: string }) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data?.roomId, socket.id);

        if (!room || room.state !== 'RESULTS') return;
        if (room.hostId !== socket.id) {
            socket.emit('errorMsg', 'Nur der Host kann die nächste Runde starten!');
            return;
        }

        // Zum nächsten Spieler in der Liste wechseln
        room.activeCreatorIndex = (room.activeCreatorIndex + 1) % room.players.length;
        room.currentRound += 1;
        room.state = 'IDLE';
        room.currentVotes = {};
        room.currentPrompt = '';
        room.currentVideoUrl = '';

        broadcastRoomUpdate(formattedRoomId);
        sendCreateScreenState(formattedRoomId);
    });

    // 7. DISCONNECT
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players[index].connected = false;
                broadcastRoomUpdate(roomId);
                room.disconnectTimers[room.players[index].sessionId] = setTimeout(() => {
                    removePlayerFromRoom(roomId, socket.id);
                }, 15000);
                break;
            }
        }
    });
});

ensureDatabaseSchema()
    .then(() => {
        console.log(isDatabaseEnabled()
            ? 'Postgres-Statistiken aktiviert.'
            : 'Keine DATABASE_URL gesetzt. Statistiken laufen ohne Persistenz.');
        server.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));
    })
    .catch(error => {
        console.error('Datenbank konnte nicht initialisiert werden:', error);
        process.exit(1);
    });
