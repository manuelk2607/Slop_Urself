"use strict";
const socket = io();
// Lobby-Elemente
const lobbySection = document.getElementById('lobbySection');
const usernameInput = document.getElementById('usernameInput');
const createRoomButton = document.getElementById('createRoomButton');
const joinRoomButton = document.getElementById('joinRoomButton');
const roomCodeInput = document.getElementById('roomCodeInput');
const lobbyError = document.getElementById('lobbyError');
// Spiel-Elemente
const gameSection = document.getElementById('gameSection');
const displayRoomCode = document.getElementById('displayRoomCode');
const playerCount = document.getElementById('playerCount');
const scoreList = document.getElementById('scoreList');
// Upload- & Prompt-Elemente
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const promptInput = document.getElementById('promptInput');
const uploadButton = document.getElementById('uploadButton');
const loadingSection = document.getElementById('loadingSection');
const loadingText = document.getElementById('loadingText');
const videoPlayer = document.getElementById('videoPlayer');
const customButton = document.querySelector('.custom-file-btn');
// Voting-Elemente
const votingSection = document.getElementById('votingSection');
const votingText = document.getElementById('votingText');
const voteButtons = document.querySelectorAll('.voteButton');
// --- LOBBY ACTIONS ---
createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        lobbyError.innerText = 'Bitte gib zuerst einen Spielernamen ein!';
        usernameInput.focus();
        return;
    }
    socket.emit('createRoom', { username });
});
joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!username) {
        lobbyError.innerText = 'Bitte gib zuerst einen Spielernamen ein!';
        usernameInput.focus();
        return;
    }
    if (!code) {
        lobbyError.innerText = 'Bitte gib einen 4-stelligen Code ein!';
        roomCodeInput.focus();
        return;
    }
    socket.emit('joinRoom', { roomId: code, username });
});
// --- SERVER EVENTS ---
socket.on('roomCreated', (data) => enterRoom(data.roomId));
socket.on('joinedSuccess', (data) => enterRoom(data.roomId));
socket.on('roomDataUpdate', (data) => {
    playerCount.innerText = data.playerCount.toString();
    // Bestenliste sortieren (Höchste Punktzahl oben)
    data.players.sort((a, b) => b.score - a.score);
    scoreList.innerHTML = '';
    data.players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = `${p.name}: ${p.score} Pkt.`;
        scoreList.appendChild(li);
    });
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
// --- UPLOAD LOGIK ---
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
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        socket.emit('sendImage', {
            roomId: currentRoomId,
            imageBase64: reader.result,
            prompt: promptText
        });
    };
});
// Fortschrittsanzeige während der 2 Stufen
socket.on('generationStarted', (data) => {
    uploadButton.disabled = true;
    uploadButton.innerText = 'KI arbeitet...';
    loadingSection.style.display = 'flex';
    if (loadingText)
        loadingText.innerText = (data === null || data === void 0 ? void 0 : data.step) || 'Stufe 1: Transformiere Bild...';
    videoPlayer.style.display = 'none';
    votingSection.style.display = 'none';
});
socket.on('generationProgress', (data) => {
    if (loadingText)
        loadingText.innerText = data.step;
});
// Video fertig -> Voting anzeigen
socket.on('videoGenerated', (data) => {
    loadingSection.style.display = 'none';
    uploadButton.disabled = false;
    uploadButton.innerText = 'KI-Video generieren';
    videoPlayer.src = data.videoUrl;
    videoPlayer.style.display = 'block';
    // Voting-Leiste einblenden
    votingSection.style.display = 'block';
    if (socket.id === data.authorId) {
        votingText.innerText = 'Das ist dein Video! Die anderen Spieler bewerten jetzt...';
        voteButtons.forEach(btn => btn.style.display = 'none');
    }
    else {
        votingText.innerText = `Bewerte das Video von ${data.authorName}:`;
        voteButtons.forEach(btn => {
            btn.style.display = 'inline-block';
            btn.disabled = false;
        });
    }
});
// Voting-Klick verarbeiten
voteButtons.forEach(button => {
    button.addEventListener('click', () => {
        const points = parseInt(button.getAttribute('data-points') || '0', 10);
        const currentRoomId = displayRoomCode.innerText;
        socket.emit('submitVote', { roomId: currentRoomId, points });
        // Buttons nach Stimmabgabe deaktivieren
        voteButtons.forEach(btn => btn.disabled = true);
        votingText.innerText = `Danke für deine Bewertung (${points} Sterne)!`;
    });
});
// Funktion für Namensfehler
function triggerNameError() {
    lobbyError.innerText = '⚠️ Bitte gib zuerst einen Spielernamen ein!';
    usernameInput.classList.add('input-error');
    usernameInput.focus();
}
// Fehler zurücksetzen, sobald der Spieler zu tippen beginnt
usernameInput.addEventListener('input', () => {
    if (usernameInput.value.trim().length > 0) {
        lobbyError.innerText = '';
        usernameInput.classList.remove('input-error');
    }
});
// Bei Raum-Erstellung prüfen
createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        triggerNameError();
        return;
    }
    socket.emit('createRoom', { username });
});
// Bei Raum-Beitritt prüfen
joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!username) {
        triggerNameError();
        return;
    }
    if (!code) {
        lobbyError.innerText = '⚠️ Bitte gib einen 4-stelligen Raumcode ein!';
        roomCodeInput.classList.add('input-error');
        roomCodeInput.focus();
        return;
    }
    socket.emit('joinRoom', { roomId: code, username });
});
