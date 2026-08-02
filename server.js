"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server);
// Stellt HTML, CSS und JS-Dateien aus dem aktuellen Ordner bereit
app.use(express_1.default.static(__dirname));
const rooms = {};
const MAX_PLAYERS = 10;
io.on('connection', (socket) => {
    console.log(`Ein Spieler hat sich verbunden: ${socket.id}`);
    // 1. RAUM ERSTELLEN
    socket.on('createRoom', () => {
        // Generiert den 4-stelligen Code (z.B. "X7K2")
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomId] = {
            players: [socket.id]
        };
        socket.join(roomId);
        // Schickt den Code an den Browser zurück
        socket.emit('roomCreated', { roomId });
        console.log(`Raum ${roomId} wurde erstellt.`);
    });
    // 2. RAUM BEITRETEN (MIT MAX. 10 SPIELERN LIMIT)
    socket.on('joinRoom', (roomId) => {
        const formattedRoomId = roomId.toUpperCase();
        const room = rooms[formattedRoomId];
        // Prüfung: Existiert der Raum?
        if (!room) {
            socket.emit('errorMsg', 'Raum wurde nicht gefunden!');
            return;
        }
        // Prüfung: Raum voll?
        if (room.players.length >= MAX_PLAYERS) {
            socket.emit('errorMsg', `Raum ${formattedRoomId} ist voll! (Max. ${MAX_PLAYERS} Spieler)`);
            return;
        }
        // Beitreten zulassen
        room.players.push(socket.id);
        socket.join(formattedRoomId);
        socket.emit('joinedSuccess', { roomId: formattedRoomId });
        io.to(formattedRoomId).emit('playerCountUpdate', { count: room.players.length });
        console.log(`Spieler ${socket.id} ist Raum ${formattedRoomId} beigetreten. (${room.players.length}/${MAX_PLAYERS})`);
    });
    // 3. VERBINDUNG TRENNEN
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.indexOf(socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                io.to(roomId).emit('playerCountUpdate', { count: room.players.length });
                // Raum löschen, wenn er leer ist
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
