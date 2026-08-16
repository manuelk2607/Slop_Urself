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
const HF_TOKEN = "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";
// WICHTIG: Limit auf 100 MB anheben (1e8 Bytes)
const io = new socket_io_1.Server(server, {
    maxHttpBufferSize: 1e8
});
app.use(express_1.default.static(__dirname));
const rooms = {};
const MAX_PLAYERS = 10;
io.on('connection', (socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);
    // 1. RAUM ERSTELLEN
    socket.on('createRoom', () => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            players: [socket.id]
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
        console.log(`Raum ${roomId} erstellt.`);
    });
    // 2. RAUM BEITRETEN
    socket.on('joinRoom', (roomId) => {
        const formattedRoomId = roomId.toUpperCase();
        const room = rooms[formattedRoomId];
        if (!room) {
            socket.emit('errorMsg', 'Raum wurde nicht gefunden!');
            return;
        }
        if (room.players.length >= MAX_PLAYERS) {
            socket.emit('errorMsg', `Raum ${formattedRoomId} ist voll! (Max. ${MAX_PLAYERS} Spieler)`);
            return;
        }
        room.players.push(socket.id);
        socket.join(formattedRoomId);
        socket.emit('joinedSuccess', { roomId: formattedRoomId });
        io.to(formattedRoomId).emit('playerCountUpdate', { count: room.players.length });
        console.log(`Spieler ${socket.id} beigetreten zu ${formattedRoomId} (${room.players.length}/${MAX_PLAYERS})`);
    });
    // 3. ECHTE KI-GENERIERUNG VIA HUGGING FACE
    // Typisierung im Event erweitern
    socket.on('sendImage', (data) => __awaiter(void 0, void 0, void 0, function* () {
        const formattedRoomId = data.roomId.toUpperCase();
        if (!data.prompt || !data.prompt.trim()) {
            socket.emit('errorMsg', 'Der Prompt darf nicht leer sein!');
            return;
        }
        console.log(`Prompt für Raum ${formattedRoomId}: "${data.prompt}"`);
        io.to(formattedRoomId).emit('generationStarted');
        try {
            const base64Data = data.imageBase64.split(',')[1];
            const mimeType = data.imageBase64.split(';')[0].split(':')[1] || 'image/png';
            const buffer = Buffer.from(base64Data, 'base64');
            const imageBlob = new Blob([buffer], { type: mimeType });
            const hfClient = yield client_1.Client.connect("Lightricks/ltx-video-distilled", {
                token: HF_TOKEN
            });
            // Den dynamischen Prompt des Nutzers an die KI übergeben
            const result = yield hfClient.predict("/generate", {
                image_path: imageBlob,
                prompt: data.prompt,
            });
            const generatedVideoUrl = result.data[0].url;
            io.to(formattedRoomId).emit('videoGenerated', { videoUrl: generatedVideoUrl });
        }
        catch (error) {
            console.error("Fehler bei KI-Generierung:", error);
            io.to(formattedRoomId).emit('errorMsg', 'KI-Generierung fehlgeschlagen oder überlastet. Bitte versuche es erneut!');
        }
    }));
    // 4. VERBINDUNG TRENNEN
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.indexOf(socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                io.to(roomId).emit('playerCountUpdate', { count: room.players.length });
                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});
server.listen(3000, () => {
    console.log('Server läuft auf http://localhost:3000');
});
