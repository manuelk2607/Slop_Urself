import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { Client, handle_file } from '@gradio/client';

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

app.use(express.static(__dirname));

const HF_TOKEN = process.env.HF_TOKEN;
const USE_MOCK_AI = process.env.USE_MOCK_AI !== 'false';
const PORT = Number(process.env.PORT) || 3000;
const MIN_ROUNDS = 1;
const AI_ROUND_LIMIT = Math.max(Number(process.env.AI_ROUND_LIMIT) || 5, MIN_ROUNDS);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface Player {
    id: string;
    name: string;
    score: number;
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
}

const rooms: Record<string, Room> = {};

function sanitizeUsername(username: unknown): string {
    return typeof username === 'string' ? username.trim().slice(0, 15) : '';
}

function sanitizeRoomId(roomId: unknown): string {
    return typeof roomId === 'string' ? roomId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : '';
}

function sanitizePrompt(prompt: unknown): string {
    return typeof prompt === 'string' ? prompt.trim().slice(0, 150) : '';
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

function broadcastRoomUpdate(roomId: string) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('roomDataUpdate', {
        playerCount: room.players.length,
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
    if (room.players.length === 0) return undefined;
    if (room.activeCreatorIndex >= room.players.length) {
        room.activeCreatorIndex = 0;
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
        activeCreatorName: activeCreator.name
    });
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

    const eligibleVoters = room.players.filter(p => p.id !== activeCreator.id);
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
            try {
                await saveScores(roomId, room.players, room.hostId);
                await markRoomFinished(roomId);
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

app.get('/api/stats', async (_req, res) => {
    try {
        res.json({
            databaseEnabled: isDatabaseEnabled(),
            players: await getStats()
        });
    } catch (error) {
        console.error('[DB] Statistiken laden fehlgeschlagen:', error);
        res.status(500).json({ error: 'Statistiken konnten nicht geladen werden.' });
    }
});

app.get('/api/config', (_req, res) => {
    res.json({
        aiRoundLimit: AI_ROUND_LIMIT,
        mockAi: USE_MOCK_AI
    });
});

io.on('connection', (socket: Socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);

    // 1. RAUM ERSTELLEN
    socket.on('createRoom', async (data: { username: string; maxRounds?: number }) => {
        const username = sanitizeUsername(data?.username);
        if (!username) {
            socket.emit('errorMsg', 'Bitte gib einen gültigen Spielernamen ein!');
            return;
        }

        const roomId = createRoomId();
        rooms[roomId] = {
            hostId: socket.id,
            players: [{ id: socket.id, name: username, score: 0 }],
            state: 'LOBBY',
            activeCreatorIndex: 0,
            currentVotes: {},
            currentRound: 1,
            maxRounds: sanitizeMaxRounds(data?.maxRounds),
            currentPrompt: '',
            currentVideoUrl: ''
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
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
    socket.on('joinRoom', async (data: { roomId: string; username: string }) => {
        const formattedRoomId = sanitizeRoomId(data?.roomId);
        const username = sanitizeUsername(data?.username);
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

        room.players.push({ id: socket.id, name: username, score: 0 });
        socket.join(formattedRoomId);
        socket.emit('joinedSuccess', { roomId: formattedRoomId });
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
            step: 'Stufe 1: Transformiere Bild...'
        });

        try {
            if (USE_MOCK_AI) {
                console.log(`[MOCK] Simuliere Generierung für ${activeCreator.name}...`);

                // Simuliert 2 Sekunden Ladezeit
                await new Promise(resolve => setTimeout(resolve, 2000));

                const dummyVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

                room.state = 'VOTING';
                room.currentVideoUrl = dummyVideoUrl;
                broadcastRoomUpdate(formattedRoomId);

                io.to(formattedRoomId).emit('showVotingScreen', {
                    videoUrl: dummyVideoUrl,
                    authorId: activeCreator.id,
                    authorName: activeCreator.name
                });

                checkVotingComplete(formattedRoomId);
                return;
            }
            if (!HF_TOKEN) {
                throw new Error('HF_TOKEN fehlt. Setze USE_MOCK_AI=true oder hinterlege einen Hugging-Face-Token.');
            }

            const base64Data = data.imageBase64.split(',')[1];
            const mimeType = data.imageBase64.split(';')[0].split(':')[1] || 'image/png';
            const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
            if (estimatedBytes > MAX_IMAGE_BYTES) {
                socket.emit('errorMsg', 'Das Bild ist zu groß. Bitte nutze maximal 8 MB.');
                room.state = 'IDLE';
                broadcastRoomUpdate(formattedRoomId);
                sendCreateScreenState(formattedRoomId);
                return;
            }

            const buffer = Buffer.from(base64Data, 'base64');
            const initialImageBlob = new Blob([buffer], { type: mimeType });

            // ============================================================
            // STUFE 1: BILD TRANSFORMIEREN (InstructPix2Pix)
            // ============================================================
            console.log("Stufe 1: Verbinde zu timbrooks/instruct-pix2pix...");
            const imgClient = await Client.connect("timbrooks/instruct-pix2pix", {
                token: HF_TOKEN as `hf_${string}`
            });

            // Prompt mit Nachdruck verstärken
            const strongPrompt = `${prompt}, dramatic visual change, cinematic lighting, intense effect`;

            console.log("Stufe 1: Führe Transformation aus mit:", strongPrompt);
            const imgResult = await imgClient.predict("/generate", [
                handle_file(initialImageBlob), // 0: Input Image
                strongPrompt,                  // 1: Edit Instruction
                30,                            // 2: Steps (30 gibt mehr Detailtiefe)
                "Randomize Seed",              // 3: randomize_seed
                Math.floor(Math.random() * 100000), // 4: seed (echter Zufall)
                "Fix CFG",                     // 5: randomize_cfg
                9.0,                           // 6: text_cfg_scale (9.0 zwingt den Prompt durch!)
                1.05                           // 7: image_cfg_scale (1.05 erlaubt drastische Zerstörung/Mutation)
            ]) as any;

            const transformedImageData = imgResult.data[3];
            const transformedImageUrl = transformedImageData?.url || transformedImageData?.path || transformedImageData;

            console.log("Stufe 1 erfolgreich:", transformedImageUrl);

            const transformedImageRes = await fetch(transformedImageUrl);
            const transformedBlob = await transformedImageRes.blob();

            io.to(formattedRoomId).emit('generationProgress', { step: 'Stufe 2: Animiere Video...' });

            // ============================================================
            // STUFE 2: VIDEO ANIMIEREN (LTX-Video)
            // ============================================================
            console.log("Stufe 2: Verbinde zu LTX-Video...");
            const videoClient = await Client.connect("Lightricks/ltx-video-distilled", {
                token: HF_TOKEN as `hf_${string}`
            });

            const videoPrompt = `${prompt}, explosive fast movement, chaotic motion, high quality`;

            const videoResult = await videoClient.predict("/image_to_video", [
                videoPrompt,                                                      // 0: Prompt
                "blurry, motionless, static frame, slow",                         // 1: Negative Prompt
                handle_file(transformedBlob),                                     // 2: Input Image (aus Stufe 1)
                null,                                                             // 3: Input Video
                512,                                                              // 4: Height
                704,                                                              // 5: Width
                "image-to-video",                                                 // 6: Mode
                4,                                                                // 7: Duration
                9,                                                                // 8: Frames
                42,                                                               // 9: Seed
                true,                                                             // 10: Randomize Seed
                1.6,                                                              // 11: Guidance Scale
                true                                                              // 12: Improve Texture
            ]) as any;

            const videoData = videoResult.data[0];
            const generatedVideoUrl = videoData?.video?.url || videoData?.url || videoData;

            room.state = 'VOTING';
            room.currentVideoUrl = generatedVideoUrl;
            broadcastRoomUpdate(formattedRoomId);

            io.to(formattedRoomId).emit('showVotingScreen', {
                videoUrl: generatedVideoUrl,
                authorId: activeCreator.id,
                authorName: activeCreator.name
            });

            checkVotingComplete(formattedRoomId);

        } catch (error) {
            console.error("Fehler in Pipeline:", error);
            room.state = 'IDLE';
            broadcastRoomUpdate(formattedRoomId);
            sendCreateScreenState(formattedRoomId);
            io.to(formattedRoomId).emit('errorMsg', 'Generierung fehlgeschlagen. Bitte erneut versuchen!');
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
                const wasActive = room.activeCreatorIndex === index;
                room.players.splice(index, 1);
                delete room.currentVotes[socket.id];

                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    if (room.hostId === socket.id) {
                        room.hostId = room.players[0].id;
                    }

                    if (room.activeCreatorIndex >= room.players.length) {
                        room.activeCreatorIndex = 0;
                    }

                    if (wasActive && (room.state === 'GENERATING' || room.state === 'VOTING')) {
                        room.state = 'IDLE';
                        room.currentVotes = {};
                        broadcastRoomUpdate(roomId);
                        sendCreateScreenState(roomId);
                        io.to(roomId).emit('errorMsg', 'Der aktive Spieler hat das Spiel verlassen. Nächster Spieler ist an der Reihe!');
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
