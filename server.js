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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const client_1 = require("@gradio/client");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, { maxHttpBufferSize: 1e8 });
app.use(express_1.default.static(__dirname));
const HF_TOKEN = "hf_DEIN_TOKEN_HIER";
const rooms = {};
const MAX_PLAYERS = 10;
function broadcastRoomUpdate(roomId) {
    const room = rooms[roomId];
    if (!room)
        return;
    io.to(roomId).emit('roomDataUpdate', {
        playerCount: room.players.length,
        players: room.players
    });
}
io.on('connection', (socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);
    // 1. RAUM ERSTELLEN
    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            players: [{ id: socket.id, name: data.username, score: 0 }]
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
        broadcastRoomUpdate(roomId);
    });
    // 2. RAUM BEITRETEN
    socket.on('joinRoom', (data) => {
        const formattedRoomId = data.roomId.toUpperCase();
        const room = rooms[formattedRoomId];
        if (!room) {
            socket.emit('errorMsg', 'Raum wurde nicht gefunden!');
            return;
        }
        if (room.players.length >= MAX_PLAYERS) {
            socket.emit('errorMsg', `Raum ist voll! (Max. ${MAX_PLAYERS} Spieler)`);
            return;
        }
        room.players.push({ id: socket.id, name: data.username, score: 0 });
        socket.join(formattedRoomId);
        socket.emit('joinedSuccess', { roomId: formattedRoomId });
        broadcastRoomUpdate(formattedRoomId);
    });
    // 3. KI-GENERIERUNG
    socket.on('sendImage', (data) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const formattedRoomId = data.roomId.toUpperCase();
        const room = rooms[formattedRoomId];
        if (!room)
            return;
        room.currentAuthorId = socket.id;
        const author = room.players.find(p => p.id === socket.id);
        const authorName = author ? author.name : 'Ein Spieler';
        io.to(formattedRoomId).emit('generationStarted');
        try {
            const base64Data = data.imageBase64.split(',')[1];
            const mimeType = data.imageBase64.split(';')[0].split(':')[1] || 'image/png';
            const buffer = Buffer.from(base64Data, 'base64');
            const imageBlob = new Blob([buffer], { type: mimeType });
            const hfClient = yield client_1.Client.connect("Lightricks/ltx-video-distilled", {
                token: HF_TOKEN
            });
            const result = yield hfClient.predict("/image_to_video", [
                data.prompt,
                "worst quality, inconsistent motion, blurry, jittery, distorted",
                (0, client_1.handle_file)(imageBlob),
                null,
                512,
                704,
                "image-to-video",
                4,
                9,
                42,
                true,
                1.0,
                true
            ]);
            const videoData = result.data[0];
            const generatedVideoUrl = ((_a = videoData === null || videoData === void 0 ? void 0 : videoData.video) === null || _a === void 0 ? void 0 : _a.url) || (videoData === null || videoData === void 0 ? void 0 : videoData.url) || videoData;
            // Video zusammen mit Ersteller-Infos ausspielen
            io.to(formattedRoomId).emit('videoGenerated', {
                videoUrl: generatedVideoUrl,
                authorId: socket.id,
                authorName: authorName
            });
        }
        catch (error) {
            console.error("Fehler bei KI-Generierung:", error);
            io.to(formattedRoomId).emit('errorMsg', 'KI-Generierung fehlgeschlagen. Bitte versuche es erneut!');
        }
    }));
    // 4. BEWERTUNG EMPFANGEN & PUNKTE VERGEBEN
    socket.on('submitVote', (data) => {
        const formattedRoomId = data.roomId.toUpperCase();
        const room = rooms[formattedRoomId];
        if (!room || !room.currentAuthorId)
            return;
        const author = room.players.find(p => p.id === room.currentAuthorId);
        if (author) {
            author.score += data.points;
            broadcastRoomUpdate(formattedRoomId);
        }
    });
    // 5. DISCONNECT
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                else {
                    broadcastRoomUpdate(roomId);
                }
                break;
            }
        }
    });
});
server.listen(3000, () => console.log('Server läuft auf http://localhost:3000'));
