"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const client_1 = require("@gradio/client");
dotenv_1.default.config({ path: '.env.local' });
dotenv_1.default.config();
const db_1 = require("./db");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, { maxHttpBufferSize: 1e8 });
app.use(express_1.default.static(__dirname));
const HF_TOKEN = process.env.HF_TOKEN;
const PORT = Number(process.env.PORT) || 3000;
const MIN_ROUNDS = 1;
const AI_ROUND_LIMIT = Math.max(Number(process.env.AI_ROUND_LIMIT) || 5, MIN_ROUNDS);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const AI_PROVIDER = parseAiProvider((_a = process.env.AI_PROVIDER) !== null && _a !== void 0 ? _a : (process.env.USE_MOCK_AI === 'false' ? 'ltx' : 'mock'));
const HF_SPACE_ID = process.env.HF_SPACE_ID || 'Lightricks/ltx-video-distilled';
const HF_PREDICT_ENDPOINT = process.env.HF_PREDICT_ENDPOINT || '/image_to_video';
const rooms = {};
function parseAiProvider(value) {
    if (value === 'ltx' || value === 'wan')
        return value;
    return 'mock';
}
function sanitizeUsername(username) {
    return typeof username === 'string' ? username.trim().slice(0, 15) : '';
}
function sanitizeRoomId(roomId) {
    return typeof roomId === 'string' ? roomId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : '';
}
function sanitizePrompt(prompt) {
    return typeof prompt === 'string' ? prompt.trim().slice(0, 150) : '';
}
function sanitizeSessionId(sessionId) {
    return typeof sessionId === 'string' ? sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : '';
}
function sanitizeMaxRounds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return 5;
    return Math.min(Math.max(Math.floor(parsed), MIN_ROUNDS), AI_ROUND_LIMIT);
}
function createRoomId() {
    let roomId = '';
    do {
        roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms[roomId]);
    return roomId;
}
function getRoomForSocket(roomId, socketId) {
    const formattedRoomId = sanitizeRoomId(roomId);
    const room = formattedRoomId ? rooms[formattedRoomId] : undefined;
    if (!room || !room.players.some(player => player.id === socketId)) {
        return { roomId: formattedRoomId };
    }
    return { roomId: formattedRoomId, room };
}
function getPlayerBySocket(room, socketId) {
    return room.players.find(player => player.id === socketId);
}
function getConnectedPlayers(room) {
    return room.players.filter(player => player.connected);
}
function broadcastRoomUpdate(roomId) {
    const room = rooms[roomId];
    if (!room)
        return;
    io.to(roomId).emit('roomDataUpdate', {
        playerCount: getConnectedPlayers(room).length,
        players: room.players,
        hostId: room.hostId,
        gameState: room.state,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds
    });
}
function logPersistenceError(action, error) {
    console.error(`[DB] ${action} fehlgeschlagen:`, error);
}
function getActiveCreator(room) {
    const connectedPlayers = getConnectedPlayers(room);
    if (connectedPlayers.length === 0)
        return undefined;
    if (room.activeCreatorIndex >= room.players.length) {
        room.activeCreatorIndex = 0;
    }
    while (room.players[room.activeCreatorIndex] && !room.players[room.activeCreatorIndex].connected) {
        room.activeCreatorIndex = (room.activeCreatorIndex + 1) % room.players.length;
    }
    return room.players[room.activeCreatorIndex];
}
function sendCreateScreenState(roomId) {
    const room = rooms[roomId];
    if (!room)
        return;
    const activeCreator = getActiveCreator(room);
    if (!activeCreator)
        return;
    io.to(roomId).emit('showCreateScreen', {
        activeCreatorId: activeCreator.id,
        activeCreatorName: activeCreator.name,
        hostId: room.hostId
    });
}
function emitRoomNotice(roomId, message) {
    io.to(roomId).emit('roomNotice', message);
}
function getRequiredHfToken() {
    if (!HF_TOKEN) {
        throw new Error('HF_TOKEN fehlt. Setze AI_PROVIDER=mock oder hinterlege einen Hugging-Face-Token.');
    }
    return HF_TOKEN;
}
function getImageBlob(imageBase64) {
    const base64Data = imageBase64.split(',')[1];
    const mimeType = imageBase64.split(';')[0].split(':')[1] || 'image/png';
    const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) {
        throw new Error('IMAGE_TOO_LARGE');
    }
    const buffer = Buffer.from(base64Data, 'base64');
    return new Blob([buffer], { type: mimeType });
}
function extractVideoUrl(result) {
    var _a, _b, _c;
    const videoData = (_b = (_a = result === null || result === void 0 ? void 0 : result.data) === null || _a === void 0 ? void 0 : _a[0]) !== null && _b !== void 0 ? _b : result;
    const url = ((_c = videoData === null || videoData === void 0 ? void 0 : videoData.video) === null || _c === void 0 ? void 0 : _c.url) || (videoData === null || videoData === void 0 ? void 0 : videoData.url) || (videoData === null || videoData === void 0 ? void 0 : videoData.path) || videoData;
    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('KI hat keine Video-URL zurueckgegeben.');
    }
    return url;
}
function generateMockVideo() {
    return __awaiter(this, void 0, void 0, function* () {
        yield new Promise(resolve => setTimeout(resolve, 2000));
        return 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
    });
}
function generateLtxVideo(imageBlob, prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield client_1.Client.connect(HF_SPACE_ID, {
            token: getRequiredHfToken()
        });
        const result = yield client.predict(HF_PREDICT_ENDPOINT, [
            prompt,
            'blurry, low quality, distorted, static, motionless',
            (0, client_1.handle_file)(imageBlob),
            null,
            512,
            704,
            'image-to-video',
            4,
            9,
            42,
            true,
            1.6,
            true
        ]);
        return extractVideoUrl(result);
    });
}
function generateWanVideo(imageBlob, prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield client_1.Client.connect(HF_SPACE_ID, {
            token: getRequiredHfToken()
        });
        const result = yield client.predict(HF_PREDICT_ENDPOINT, [
            (0, client_1.handle_file)(imageBlob),
            prompt,
            'blurry, low quality, distorted, static, motionless',
            42,
            true
        ]);
        return extractVideoUrl(result);
    });
}
function generateAiVideo(imageBase64, prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        if (AI_PROVIDER === 'mock') {
            return generateMockVideo();
        }
        const imageBlob = getImageBlob(imageBase64);
        if (AI_PROVIDER === 'wan') {
            return generateWanVideo(imageBlob, prompt);
        }
        return generateLtxVideo(imageBlob, prompt);
    });
}
function persistFinishedRound(roomId, room, activeCreator, totalRoundPoints) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield (0, db_1.saveScores)(roomId, room.players, room.hostId);
            yield (0, db_1.saveRound)({
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
        }
        catch (error) {
            logPersistenceError('Runde speichern', error);
        }
    });
}
function checkVotingComplete(roomId) {
    return __awaiter(this, void 0, void 0, function* () {
        const room = rooms[roomId];
        if (!room || room.state !== 'VOTING')
            return;
        const activeCreator = getActiveCreator(room);
        if (!activeCreator)
            return;
        const eligibleVoters = getConnectedPlayers(room).filter(p => p.id !== activeCreator.id);
        const votesCount = Object.keys(room.currentVotes).length;
        // Wenn alle anderen abgestimmt haben (oder man alleine testet)
        if (votesCount >= eligibleVoters.length || eligibleVoters.length === 0) {
            let totalRoundPoints = 0;
            for (const pts of Object.values(room.currentVotes)) {
                totalRoundPoints += pts;
            }
            activeCreator.score += totalRoundPoints;
            yield persistFinishedRound(roomId, room, activeCreator, totalRoundPoints);
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
                    yield (0, db_1.saveScores)(roomId, room.players, room.hostId);
                    yield (0, db_1.markRoomFinished)(roomId, finalStandings);
                }
                catch (error) {
                    logPersistenceError('Raum abschliessen', error);
                }
                broadcastRoomUpdate(roomId);
                io.to(roomId).emit('showGameOverScreen', {
                    players: [...room.players].sort((a, b) => b.score - a.score),
                    maxRounds: room.maxRounds
                });
            }
        }
        else {
            io.to(roomId).emit('voteProgress', {
                voted: votesCount,
                total: eligibleVoters.length
            });
        }
    });
}
function removePlayerFromRoom(roomId, socketId, announce = true) {
    var _a;
    const room = rooms[roomId];
    if (!room)
        return;
    const index = room.players.findIndex(p => p.id === socketId);
    if (index === -1)
        return;
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
        const nextHost = (_a = getConnectedPlayers(room)[0]) !== null && _a !== void 0 ? _a : room.players[0];
        room.hostId = nextHost.id;
        if (announce)
            emitRoomNotice(roomId, `${removedPlayer.name} hat den Raum verlassen. ${nextHost.name} ist jetzt Host.`);
    }
    else if (announce) {
        emitRoomNotice(roomId, `${removedPlayer.name} hat den Raum verlassen.`);
    }
    if (room.activeCreatorIndex >= room.players.length) {
        room.activeCreatorIndex = 0;
    }
    if (wasActive && (room.state === 'GENERATING' || room.state === 'VOTING')) {
        room.state = 'IDLE';
        room.currentVotes = {};
        broadcastRoomUpdate(roomId);
        sendCreateScreenState(roomId);
        emitRoomNotice(roomId, 'Der aktive Spieler hat das Spiel verlassen. Die Runde wurde zurückgesetzt.');
    }
    else if (room.state === 'VOTING') {
        void checkVotingComplete(roomId);
        broadcastRoomUpdate(roomId);
    }
    else {
        broadcastRoomUpdate(roomId);
        if (room.state === 'IDLE') {
            sendCreateScreenState(roomId);
        }
    }
}
app.get('/api/stats', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        res.json({
            databaseEnabled: (0, db_1.isDatabaseEnabled)(),
            players: yield (0, db_1.getStats)()
        });
    }
    catch (error) {
        console.error('[DB] Statistiken laden fehlgeschlagen:', error);
        res.status(500).json({ error: 'Statistiken konnten nicht geladen werden.' });
    }
}));
app.get('/api/config', (_req, res) => {
    res.json({
        aiRoundLimit: AI_ROUND_LIMIT,
        aiProvider: AI_PROVIDER,
        mockAi: AI_PROVIDER === 'mock'
    });
});
io.on('connection', (socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);
    // 1. RAUM ERSTELLEN
    socket.on('createRoom', (data) => __awaiter(void 0, void 0, void 0, function* () {
        const username = sanitizeUsername(data === null || data === void 0 ? void 0 : data.username);
        const sessionId = sanitizeSessionId(data === null || data === void 0 ? void 0 : data.sessionId) || socket.id;
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
            maxRounds: sanitizeMaxRounds(data === null || data === void 0 ? void 0 : data.maxRounds),
            currentPrompt: '',
            currentVideoUrl: '',
            disconnectTimers: {}
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, sessionId });
        broadcastRoomUpdate(roomId);
        try {
            yield (0, db_1.saveRoom)(roomId, socket.id, rooms[roomId].maxRounds);
            yield (0, db_1.savePlayer)({
                roomCode: roomId,
                playerSocketId: socket.id,
                name: username,
                score: 0,
                isHost: true
            });
        }
        catch (error) {
            logPersistenceError('Raum erstellen speichern', error);
        }
    }));
    // 2. RAUM BEITRETEN
    socket.on('joinRoom', (data) => __awaiter(void 0, void 0, void 0, function* () {
        const formattedRoomId = sanitizeRoomId(data === null || data === void 0 ? void 0 : data.roomId);
        const username = sanitizeUsername(data === null || data === void 0 ? void 0 : data.username);
        const sessionId = sanitizeSessionId(data === null || data === void 0 ? void 0 : data.sessionId) || socket.id;
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
            yield (0, db_1.savePlayer)({
                roomCode: formattedRoomId,
                playerSocketId: socket.id,
                name: username,
                score: 0,
                isHost: false
            });
        }
        catch (error) {
            logPersistenceError('Spieler speichern', error);
        }
    }));
    socket.on('resumeRoom', (data) => {
        var _a, _b, _c, _d, _e;
        const formattedRoomId = sanitizeRoomId(data === null || data === void 0 ? void 0 : data.roomId);
        const sessionId = sanitizeSessionId(data === null || data === void 0 ? void 0 : data.sessionId);
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
        if (room.hostId === oldSocketId)
            room.hostId = socket.id;
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
        if (room.state === 'LOBBY')
            return;
        if (room.state === 'IDLE' || room.state === 'GENERATING') {
            sendCreateScreenState(formattedRoomId);
        }
        else if (room.state === 'VOTING') {
            socket.emit('showVotingScreen', {
                videoUrl: room.currentVideoUrl,
                authorId: (_a = getActiveCreator(room)) === null || _a === void 0 ? void 0 : _a.id,
                authorName: (_c = (_b = getActiveCreator(room)) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : 'Spieler'
            });
            void checkVotingComplete(formattedRoomId);
        }
        else if (room.state === 'RESULTS') {
            socket.emit('showResultsScreen', {
                authorName: (_e = (_d = getActiveCreator(room)) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : 'Spieler',
                roundPoints: 0,
                players: room.players,
                currentRound: room.currentRound,
                maxRounds: room.maxRounds,
                isFinalRound: room.currentRound >= room.maxRounds
            });
        }
        else if (room.state === 'GAME_OVER') {
            socket.emit('showGameOverScreen', {
                players: [...room.players].sort((a, b) => b.score - a.score),
                maxRounds: room.maxRounds
            });
        }
    });
    socket.on('leaveRoom', (data) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data === null || data === void 0 ? void 0 : data.roomId, socket.id);
        if (!room)
            return;
        socket.leave(formattedRoomId);
        removePlayerFromRoom(formattedRoomId, socket.id);
        socket.emit('leftRoom');
    });
    // 3. SPIEL STARTEN (NUR HOST)
    socket.on('startGame', (data) => __awaiter(void 0, void 0, void 0, function* () {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data === null || data === void 0 ? void 0 : data.roomId, socket.id);
        if (!room || room.state !== 'LOBBY')
            return;
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
            yield (0, db_1.markRoomStarted)(formattedRoomId);
            yield (0, db_1.saveScores)(formattedRoomId, room.players, room.hostId);
        }
        catch (error) {
            logPersistenceError('Spielstart speichern', error);
        }
    }));
    // 4. KI-GENERIERUNG (NUR FÜR DEN AKTIVEN SPIELER ERLAUBT)
    socket.on('sendImage', (data) => __awaiter(void 0, void 0, void 0, function* () {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data === null || data === void 0 ? void 0 : data.roomId, socket.id);
        const prompt = sanitizePrompt(data === null || data === void 0 ? void 0 : data.prompt);
        if (!room || room.state !== 'IDLE')
            return;
        if (!prompt) {
            socket.emit('errorMsg', 'Bitte gib eine gültige Anweisung ein!');
            return;
        }
        if (typeof (data === null || data === void 0 ? void 0 : data.imageBase64) !== 'string' || !data.imageBase64.startsWith('data:image/')) {
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
            const generatedVideoUrl = yield generateAiVideo(data.imageBase64, prompt);
            room.state = 'VOTING';
            room.currentVideoUrl = generatedVideoUrl;
            broadcastRoomUpdate(formattedRoomId);
            io.to(formattedRoomId).emit('showVotingScreen', {
                videoUrl: generatedVideoUrl,
                authorId: activeCreator.id,
                authorName: activeCreator.name
            });
            checkVotingComplete(formattedRoomId);
        }
        catch (error) {
            console.error("Fehler in Pipeline:", error);
            room.state = 'IDLE';
            broadcastRoomUpdate(formattedRoomId);
            sendCreateScreenState(formattedRoomId);
            const message = error instanceof Error && error.message === 'IMAGE_TOO_LARGE'
                ? 'Das Bild ist zu groß. Bitte nutze maximal 8 MB.'
                : 'Generierung fehlgeschlagen. Bitte erneut versuchen!';
            io.to(formattedRoomId).emit('errorMsg', message);
        }
    }));
    // 5. BEWERTUNG EMPFANGEN
    socket.on('submitVote', (data) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data === null || data === void 0 ? void 0 : data.roomId, socket.id);
        if (!room || room.state !== 'VOTING')
            return;
        const activeCreator = getActiveCreator(room);
        if (activeCreator && socket.id === activeCreator.id)
            return; // Ersteller darf nicht für sich selbst stimmen
        const points = Number(data === null || data === void 0 ? void 0 : data.points);
        if (!Number.isFinite(points))
            return;
        room.currentVotes[socket.id] = Math.min(Math.max(Math.floor(points), 1), 5);
        void checkVotingComplete(formattedRoomId);
    });
    // 6. NÄCHSTE RUNDE STARTEN (ROTATION)
    socket.on('startNextRound', (data) => {
        const { roomId: formattedRoomId, room } = getRoomForSocket(data === null || data === void 0 ? void 0 : data.roomId, socket.id);
        if (!room || room.state !== 'RESULTS')
            return;
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
(0, db_1.ensureDatabaseSchema)()
    .then(() => {
    console.log((0, db_1.isDatabaseEnabled)()
        ? 'Postgres-Statistiken aktiviert.'
        : 'Keine DATABASE_URL gesetzt. Statistiken laufen ohne Persistenz.');
    server.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));
})
    .catch(error => {
    console.error('Datenbank konnte nicht initialisiert werden:', error);
    process.exit(1);
});
