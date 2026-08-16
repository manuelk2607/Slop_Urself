import express from 'express';
import http from 'http';
import {Server, Socket} from 'socket.io';
import {Client, handle_file} from '@gradio/client';

const app = express();
const server = http.createServer(app);
const HF_TOKEN = "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";

// WICHTIG: Limit auf 100 MB anheben (1e8 Bytes)
const io = new Server(server, {
    maxHttpBufferSize: 1e8
});

app.use(express.static(__dirname));

interface Room {
    players: string[];
}

const rooms: Record<string, Room> = {};
const MAX_PLAYERS = 10;

io.on('connection', (socket: Socket) => {
    console.log(`Spieler verbunden: ${socket.id}`);

    // 1. RAUM ERSTELLEN
    socket.on('createRoom', () => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();

        rooms[roomId] = {
            players: [socket.id]
        };

        socket.join(roomId);
        socket.emit('roomCreated', {roomId});
        console.log(`Raum ${roomId} erstellt.`);
    });

    // 2. RAUM BEITRETEN
    socket.on('joinRoom', (roomId: string) => {
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

        socket.emit('joinedSuccess', {roomId: formattedRoomId});
        io.to(formattedRoomId).emit('playerCountUpdate', {count: room.players.length});

        console.log(`Spieler ${socket.id} beigetreten zu ${formattedRoomId} (${room.players.length}/${MAX_PLAYERS})`);
    });

    // 3. ECHTE KI-GENERIERUNG VIA HUGGING FACE
    // Typisierung im Event erweitern
    socket.on('sendImage', async (data: { roomId: string; imageBase64: string; prompt: string }) => {
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
            const imageBlob = new Blob([buffer], {type: mimeType});

            console.log("Verbinde zum Hugging Face Space...");
            const hfClient = await Client.connect("Lightricks/ltx-video-distilled", {
                token: HF_TOKEN as `hf_${string}`
            });

            const minDuration = 4.0, maxDuration = 8.5;
            const videoDuration = Number((Math.random() * (maxDuration - minDuration) + minDuration).toFixed(1));
            console.log("Generiere Video via Space...");

            // Exakte Parameterliste gemäß API-Schnittstelle (13 Argumente)
            const result = await hfClient.predict("/image_to_video", [
                data.prompt,                                                  // 0: Prompt
                "worst quality, inconsistent motion, blurry, jittery, distorted", // 1: Negative Prompt
                handle_file(imageBlob),                                       // 2: Input Image
                null,                                                         // 3: Input Video (leer bei Bild-zu-Video)
                512,                                                          // 4: Height
                704,                                                          // 5: Width
                "image-to-video",                                             // 6: Mode
                videoDuration,                                                            // 7: Video Duration (Sekunden)
                9,                                                            // 8: Frames to use
                42,                                                           // 9: Seed
                true,                                                         // 10: Randomize Seed
                1.0,                                                          // 11: Guidance Scale (CFG)
                true                                                          // 12: Improve Texture
            ]) as any;

            // Video-URL aus der Rückgabe extrahieren
            const videoData = result.data[0];
            const generatedVideoUrl = videoData?.video?.url || videoData?.url || videoData;

            console.log("Video erfolgreich erstellt:", generatedVideoUrl);

            io.to(formattedRoomId).emit('videoGenerated', { videoUrl: generatedVideoUrl });
        } catch (error) {
            console.error("Fehler bei KI-Generierung:", error);
            io.to(formattedRoomId).emit('errorMsg', 'KI-Generierung fehlgeschlagen oder überlastet. Bitte versuche es erneut!');
        }
    });

    // 4. VERBINDUNG TRENNEN
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.indexOf(socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                io.to(roomId).emit('playerCountUpdate', {count: room.players.length});

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