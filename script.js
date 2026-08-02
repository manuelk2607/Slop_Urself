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
const uploadButton = document.getElementById('uploadButton');
const loadingSection = document.getElementById('loadingSection');
const videoPlayer = document.getElementById('videoPlayer');
const customButton = document.querySelector('.custom-file-btn');
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
    lobbyError.innerText = msg;
});
function enterRoom(roomId) {
    lobbyError.innerText = '';
    lobbySection.style.display = 'none';
    gameSection.style.display = 'block';
    displayRoomCode.innerText = roomId;
}
// --- UPLOAD LOGIK ---
imageInput.addEventListener('change', (event) => {
    var _a;
    const target = event.target;
    const file = (_a = target.files) === null || _a === void 0 ? void 0 : _a[0];
    if (file) {
        const imageUrl = URL.createObjectURL(file);
        imagePreview.src = imageUrl;
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
uploadButton.addEventListener('click', () => {
    var _a;
    if (!((_a = imageInput.files) === null || _a === void 0 ? void 0 : _a[0])) {
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
