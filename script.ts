// Socket.io vom Browser-Window greifen
declare const io: () => any;
const socket = io();

// Lobby-Elemente
const lobbySection = document.getElementById('lobbySection') as HTMLDivElement;
const createRoomButton = document.getElementById('createRoomButton') as HTMLButtonElement;
const joinRoomButton = document.getElementById('joinRoomButton') as HTMLButtonElement;
const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement;
const lobbyError = document.getElementById('lobbyError') as HTMLParagraphElement;

// Spiel- & Raum-Elemente
const gameSection = document.getElementById('gameSection') as HTMLDivElement;
const displayRoomCode = document.getElementById('displayRoomCode') as HTMLElement;
const playerCount = document.getElementById('playerCount') as HTMLElement;

// Upload-Elemente
const imageInput = document.getElementById('imageInput') as HTMLInputElement;
const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;
const uploadButton = document.getElementById('uploadButton') as HTMLButtonElement;
const loadingSection = document.getElementById('loadingSection') as HTMLDivElement;
const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
const customButton = document.querySelector('.custom-file-btn') as HTMLLabelElement;

// --- SOCKET.IO LOBBY ACTIONS ---

createRoomButton.addEventListener('click', () => {
    socket.emit('createRoom');
});

joinRoomButton.addEventListener('click', () => {
    const code = roomCodeInput.value.trim();
    if (!code) {
        lobbyError.innerText = 'Bitte gib einen 4-stelligen Code ein!';
        return;
    }
    socket.emit('joinRoom', code);
});

// --- SERVER ANTWORTEN (EVENTS) ---

socket.on('roomCreated', (data: { roomId: string }) => {
    enterRoom(data.roomId);
});

socket.on('joinedSuccess', (data: { roomId: string }) => {
    enterRoom(data.roomId);
});

socket.on('playerCountUpdate', (data: { count: number }) => {
    playerCount.innerText = data.count.toString();
});

socket.on('errorMsg', (msg: string) => {
    lobbyError.innerText = msg;
});

function enterRoom(roomId: string) {
    lobbyError.innerText = '';
    lobbySection.style.display = 'none';
    gameSection.style.display = 'block';
    displayRoomCode.innerText = roomId;
}

// --- UPLOAD LOGIK ---

imageInput.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (file) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.style.display = 'block';
        if (customButton) customButton.innerText = '📸 Anderes Bild auswählen';
    } else {
        imagePreview.style.display = 'none';
        imagePreview.src = '';
        if (customButton) customButton.innerText = '📸 Bild auswählen';
    }
});

uploadButton.addEventListener('click', () => {
    if (!imageInput.files?.[0]) {
        alert('Bitte wähle zuerst ein Bild aus!');
        return;
    }

    uploadButton.disabled = true;
    uploadButton.innerText = 'Wird generiert...';
    loadingSection.style.display = 'flex';
    videoPlayer.style.display = 'none';

    setTimeout(() => {
        loadingSection.style.display = 'none';
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';

        videoPlayer.src = 'https://www.w3schools.com/html/mov_bbb.mp4';
        videoPlayer.style.display = 'block';
    }, 4000);
});