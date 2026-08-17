import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { Client, handle_file } from '@gradio/client';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static(__dirname));

const HF_TOKEN = "hf_DEIN_TOKEN_HIER";

interface Player {
    id: string;
    name: string;
    score: number;
}

interface Room {
    players: Player[];
    currentAuthorId?: string;
}

const rooms: Record<string, Room> = {};
const MAX_PLAYERS = 10;

function broadcastRoomUpdate(roomId: string) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('roomDataUpdate', {
        playerCount: room.players.length,
        players: room.players
    });
}

io.on('connection', (socket: Socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);

    // 1. RAUM ERSTELLEN
    socket.on('createRoom', (data: { username: string }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();

        rooms[roomId] = {
            players: [{ id: socket.id, name: data.username, score: 0 }]
        };

        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
        broadcastRoomUpdate(roomId);
    });

    // 2. RAUM BEITRETEN
    socket.on('joinRoom', (data: { roomId: string; username: string }) => {
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
    socket.on('sendImage', async (data: { roomId: string; imageBase64: string; prompt: string }) => {
        const formattedRoomId = data.roomId.toUpperCase();
        const room = rooms[formattedRoomId];

        if (!room) return;
        room.currentAuthorId = socket.id;

        const author = room.players.find(p => p.id === socket.id);
        const authorName = author ? author.name : 'Ein Spieler';

        io.to(formattedRoomId).emit('generationStarted');

        try {
            const base64Data = data.imageBase64.split(',')[1];
            const mimeType = data.imageBase64.split(';')[0].split(':')[1] || 'image/png';
            const buffer = Buffer.from(base64Data, 'base64');
            const imageBlob = new Blob([buffer], { type: mimeType });

            const hfClient = await Client.connect("Lightricks/ltx-video-distilled", {
                token: HF_TOKEN as `hf_${string}`
            });

            const result = await hfClient.predict("/image_to_video", [
                data.prompt,
                "worst quality, inconsistent motion, blurry, jittery, distorted",
                handle_file(imageBlob),
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
            ]) as any;

            const videoData = result.data[0];
            const generatedVideoUrl = videoData?.video?.url || videoData?.url || videoData;

            // Video zusammen mit Ersteller-Infos ausspielen
            io.to(formattedRoomId).emit('videoGenerated', {
                videoUrl: generatedVideoUrl,
                authorId: socket.id,
                authorName: authorName
            });

        } catch (error) {
            console.error("Fehler bei KI-Generierung:", error);
            io.to(formattedRoomId).emit('errorMsg', 'KI-Generierung fehlgeschlagen. Bitte versuche es erneut!');
        }
    });

    // 4. BEWERTUNG EMPFANGEN & PUNKTE VERGEBEN
    socket.on('submitVote', (data: { roomId: string; points: number }) => {
        const formattedRoomId = data.roomId.toUpperCase();
        const room = rooms[formattedRoomId];
        if (!room || !room.currentAuthorId) return;

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
                } else {
                    broadcastRoomUpdate(roomId);
                }
                break;
            }
        }
    });
});

server.listen(3000, () => console.log('Server läuft auf http://localhost:3000'));