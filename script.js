"use strict";
const socket = io();
// Lobby-Elemente
const lobbySection = document.getElementById('lobbySection');
const createRoomButton = document.getElementById('createRoomButton');
const joinRoomButton = document.getElementById('joinRoomButton');
const roomCodeInput = document.getElementById('roomCodeInput');
const lobbyError = document.getElementById('lobbyError');
// Spiel- & Raum-Elemente
const gameSection = document.getElementById('gameSection');
const displayRoomCode = document.getElementById('displayRoomCode');
const playerCount = document.getElementById('playerCount');
// Upload-Elemente
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const promptInput = document.getElementById('promptInput');
const uploadButton = document.getElementById('uploadButton');
const loadingSection = document.getElementById('loadingSection');
const videoPlayer = document.getElementById('videoPlayer');
const customButton = document.querySelector('.custom-file-btn');
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
socket.on('roomCreated', (data) => {
    enterRoom(data.roomId);
});
socket.on('joinedSuccess', (data) => {
    enterRoom(data.roomId);
});
socket.on('playerCountUpdate', (data) => {
    playerCount.innerText = data.count.toString();
});
socket.on('errorMsg', (msg) => {
    if (lobbySection.style.display !== 'none') {
        lobbyError.innerText = msg;
    }
    else {
        alert(msg);
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
        loadingSection.style.display = 'none';
    }
});
function enterRoom(roomId) {
    lobbyError.innerText = '';
    lobbySection.style.display = 'none';
    gameSection.style.display = 'block';
    displayRoomCode.innerText = roomId;
}
// --- UPLOAD & SPIEL LOGIK ---
imageInput.addEventListener('change', (event) => {
    var _a;
    const target = event.target;
    const file = (_a = target.files) === null || _a === void 0 ? void 0 : _a[0];
    if (file) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.style.display = 'block';
        if (customButton)
            customButton.innerText = '📸 Anderes Bild auswählen';
    }
    else {
        imagePreview.style.display = 'none';
        imagePreview.src = '';
        if (customButton)
            customButton.innerText = '📸 Bild auswählen';
    }
});
// Bild an Server schicken
uploadButton.addEventListener('click', () => {
    var _a;
    const file = (_a = imageInput.files) === null || _a === void 0 ? void 0 : _a[0];
    const promptText = promptInput.value.trim();
    if (!file) {
        alert('Bitte wähle zuerst ein Bild aus!');
        return;
    }
    if (!promptText) {
        alert('Bitte gib eine Anweisung (Prompt) ein!');
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
        const imageBase64 = reader.result;
        socket.emit('sendImage', { roomId: currentRoomId, imageBase64: imageBase64, prompt: promptText });
    };
    reader.onload = () => {
        const imageBase64 = reader.result;
        // Falls das Feld leer gelassen wurde, Fallback-Prompt nutzen
        const promptText = promptInput.value.trim() || 'animate this image smoothly';
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
socket.on('videoGenerated', (data) => {
    loadingSection.style.display = 'none';
    uploadButton.disabled = false;
    uploadButton.innerText = 'KI-Video generieren';
    videoPlayer.src = data.videoUrl;
    videoPlayer.style.display = 'block';
});
