import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { Client, handle_file } from '@gradio/client';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static(__dirname));

const HF_TOKEN = "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";

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

    // 3. 2-STUFEN KI-GENERIERUNG (Img2Img -> Img2Video)
    // 3. 2-STUFEN KI-GENERIERUNG (InstructPix2Pix -> LTX-Video)
    socket.on('sendImage', async (data: { roomId: string; imageBase64: string; prompt: string }) => {
        const formattedRoomId = data.roomId.toUpperCase();
        const room = rooms[formattedRoomId];

        if (!room) return;
        room.currentAuthorId = socket.id;

        const author = room.players.find(p => p.id === socket.id);
        const authorName = author ? author.name : 'Ein Spieler';

        console.log(`Starte 2-Stufen-Generierung für ${authorName}: "${data.prompt}"`);
        io.to(formattedRoomId).emit('generationStarted', { step: 'Stufe 1: Transformiere Bild...' });

        try {
            // Ausgangsbild vorbereiten
            const base64Data = data.imageBase64.split(',')[1];
            const mimeType = data.imageBase64.split(';')[0].split(':')[1] || 'image/png';
            const buffer = Buffer.from(base64Data, 'base64');
            const initialImageBlob = new Blob([buffer], { type: mimeType });

            // ==========================================
            // STUFE 1: BILD TRANSFORMIEREN (InstructPix2Pix)
            // ==========================================
            console.log("Stufe 1: Verbinde zu timbrooks/instruct-pix2pix...");
            const imgClient = await Client.connect("timbrooks/instruct-pix2pix", {
                token: HF_TOKEN as `hf_${string}`
            });

            console.log("Stufe 1: Führe Bild-Transformation aus...");

            // Exakte 8 Parameter gemäß Schnittstelle
            const imgResult = await imgClient.predict("/generate", [
                handle_file(initialImageBlob), // 0: Input Image
                data.prompt,                   // 1: Edit Instruction (z.B. "make this person explode into fire")
                25,                            // 2: Steps (25 reicht für schnelle & gute Ergebnisse)
                "Randomize Seed",              // 3: randomize_seed
                1371,                          // 4: seed
                "Fix CFG",                     // 5: randomize_cfg ("Fix CFG", damit feste Werte greifen)
                7.5,                           // 6: text_cfg_scale (Stärke des Prompts)
                1.3                            // 7: image_cfg_scale (1.2 - 1.5 für gute Ähnlichkeit)
            ]) as any;

            // WICHTIG: Das generierte Bild liegt bei Index 3!
            const transformedImageData = imgResult.data[3];
            const transformedImageUrl = transformedImageData?.url || transformedImageData?.path || transformedImageData;

            console.log("Stufe 1 fertig. Transformiertes Bild URL:", transformedImageUrl);

            // Bild als Blob für Stufe 2 herunterladen
            const transformedImageRes = await fetch(transformedImageUrl);
            const transformedBlob = await transformedImageRes.blob();


            // Status-Update an Spieler
            io.to(formattedRoomId).emit('generationProgress', { step: 'Stufe 2: Erstelle Video-Animation...' });

            // ==========================================
            // STUFE 2: VIDEO ANIMIEREN (LTX-Video)
            // ==========================================
            console.log("Stufe 2: Verbinde zu LTX-Video...");
            const videoClient = await Client.connect("Lightricks/ltx-video-distilled", {
                token: HF_TOKEN as `hf_${string}`
            });

            const videoResult = await videoClient.predict("/image_to_video", [
                `${data.prompt}, realistic dynamic motion, high quality`,        // 0: Prompt
                "blurry, motionless, static frame, distorted noise",              // 1: Negative Prompt
                handle_file(transformedBlob),                                     // 2: Transformiertes Bild
                null,                                                             // 3: Input Video
                512,                                                              // 4: Height
                704,                                                              // 5: Width
                "image-to-video",                                                 // 6: Mode
                4,                                                                // 7: Video Duration (4s)
                9,                                                                // 8: Frames
                42,                                                               // 9: Seed
                true,                                                             // 10: Randomize Seed
                1.8,                                                              // 11: Guidance Scale
                true                                                              // 12: Improve Texture
            ]) as any;

            const videoData = videoResult.data[0];
            const generatedVideoUrl = videoData?.video?.url || videoData?.url || videoData;

            console.log("Stufe 2 fertig. Video:", generatedVideoUrl);

            io.to(formattedRoomId).emit('videoGenerated', {
                videoUrl: generatedVideoUrl,
                authorId: socket.id,
                authorName: authorName
            });

        } catch (error) {
            console.error("Fehler in der 2-Stufen-Pipeline:", error);
            io.to(formattedRoomId).emit('errorMsg', 'Generierung fehlgeschlagen. Bitte versuche es erneut!');
        }
    });

    // 4. BEWERTUNG EMPFANGEN
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