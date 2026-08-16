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
const promptInput = document.getElementById('promptInput') as HTMLInputElement;
const uploadButton = document.getElementById('uploadButton') as HTMLButtonElement;
const loadingSection = document.getElementById('loadingSection') as HTMLDivElement;
const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
const customButton = document.querySelector('.custom-file-btn') as HTMLLabelElement;

// --- LOBBY ACTIONS ---

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

// --- LOBBY EVENTS ---

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
    if (lobbySection.style.display !== 'none') {
        lobbyError.innerText = msg;
    } else {
        alert(msg);
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
        loadingSection.style.display = 'none';
    }
});

function enterRoom(roomId: string) {
    lobbyError.innerText = '';
    lobbySection.style.display = 'none';
    gameSection.style.display = 'block';
    displayRoomCode.innerText = roomId;
}

// --- UPLOAD & SPIEL LOGIK ---

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


// Bild an Server schicken
uploadButton.addEventListener('click', () => {
    const file = imageInput.files?.[0];
    const promptText = promptInput.value.trim();
    if (!file) {
        alert('Bitte wähle zuerst ein Bild aus!');
        return;
    }

    if (!promptText) {
        alert('Bitte gib einen Prompt ein!');
        promptInput.focus();
        return;
    }

    const currentRoomId = displayRoomCode.innerText;
    if (!currentRoomId || currentRoomId === '----') {
        alert('Du bist in keinem gültigen Raum!');
        return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = () => {
        const imageBase64 = reader.result as string;
        socket.emit('sendImage', { roomId: currentRoomId, imageBase64: imageBase64, prompt: promptText });
    };

    reader.onload = () => {
        const imageBase64 = reader.result as string;

        socket.emit('sendImage', {
            roomId: currentRoomId,
            imageBase64: imageBase64,
            prompt: promptText
        });
    };
});

// Wenn die KI zu rechnen beginnt (wird bei ALLEN im Raum getriggert)
socket.on('generationStarted', () => {
    uploadButton.disabled = true;
    uploadButton.innerText = 'KI generiert Video...';
    loadingSection.style.display = 'flex';
    videoPlayer.style.display = 'none';
});

// Wenn das Video fertig ist (wird bei ALLEN im Raum getriggert)
socket.on('videoGenerated', (data: { videoUrl: string }) => {
    loadingSection.style.display = 'none';
    uploadButton.disabled = false;
    uploadButton.innerText = 'KI-Video generieren';

    videoPlayer.src = data.videoUrl;
    videoPlayer.style.display = 'block';
});