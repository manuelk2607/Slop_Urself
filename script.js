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
const socket = io();
// Header
const gameHeader = document.getElementById('gameHeader');
const displayRoomCode = document.getElementById('displayRoomCode');
const playerCount = document.getElementById('playerCount');
const roundCounter = document.getElementById('roundCounter');
const copyRoomCodeButton = document.getElementById('copyRoomCodeButton');
const leaveRoomButton = document.getElementById('leaveRoomButton');
const roomNotice = document.getElementById('roomNotice');
// Screens
const screenLobby = document.getElementById('screenLobby');
const screenStats = document.getElementById('screenStats');
const screenRoomLobby = document.getElementById('screenRoomLobby');
const screenCreate = document.getElementById('screenCreate');
const screenVoting = document.getElementById('screenVoting');
const screenResult = document.getElementById('screenResult');
const screenGameOver = document.getElementById('screenGameOver');
// Lobby-Elemente
const usernameInput = document.getElementById('usernameInput');
const roundCountInput = document.getElementById('roundCountInput');
const roundLimitHint = document.getElementById('roundLimitHint');
const createRoomButton = document.getElementById('createRoomButton');
const joinRoomButton = document.getElementById('joinRoomButton');
const statsButton = document.getElementById('statsButton');
const backToLobbyButton = document.getElementById('backToLobbyButton');
const roomCodeInput = document.getElementById('roomCodeInput');
const lobbyError = document.getElementById('lobbyError');
const statsNotice = document.getElementById('statsNotice');
const statsList = document.getElementById('statsList');
const hostNotice = document.getElementById('hostNotice');
const lobbyPlayerList = document.getElementById('lobbyPlayerList');
const startGameButton = document.getElementById('startGameButton');
// Create / Wait-Elemente
const creatorControls = document.getElementById('creatorControls');
const waitControls = document.getElementById('waitControls');
const waitNoticeText = document.getElementById('waitNoticeText');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const promptInput = document.getElementById('promptInput');
const uploadButton = document.getElementById('uploadButton');
const customButton = document.querySelector('.custom-file-btn');
const loadingSection = document.getElementById('loadingSection');
const loadingText = document.getElementById('loadingText');
// Voting-Elemente
const authorNotice = document.getElementById('authorNotice');
const votingVideoPlayer = document.getElementById('votingVideoPlayer');
const votingActionBox = document.getElementById('votingActionBox');
const votingWaitingBox = document.getElementById('votingWaitingBox');
const votingStatusText = document.getElementById('votingStatusText');
const voteButtons = document.querySelectorAll('.voteBtn');
// Result-Elemente
const resultAuthorName = document.getElementById('resultAuthorName');
const resultPointsSummary = document.getElementById('resultPointsSummary');
const scoreList = document.getElementById('scoreList');
const nextRoundButton = document.getElementById('nextRoundButton');
const winnerName = document.getElementById('winnerName');
const finalScoreList = document.getElementById('finalScoreList');
const restartButton = document.getElementById('restartButton');
let previewObjectUrl = null;
let currentRoomId = '';
let currentHostId = '';
let currentSessionId = '';
let aiRoundLimit = 5;
let noticeTimeout;
const storedSessionRaw = localStorage.getItem('slopurself-session');
function createSessionId() {
    if (crypto.randomUUID)
        return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function saveSession(roomId, sessionId) {
    currentRoomId = roomId;
    currentSessionId = sessionId;
    localStorage.setItem('slopurself-session', JSON.stringify({ roomId, sessionId }));
}
function clearSession() {
    currentRoomId = '';
    currentSessionId = '';
    localStorage.removeItem('slopurself-session');
}
// --- SCREEN SWITCHER ---
function showScreen(screenToShow) {
    [screenLobby, screenStats, screenRoomLobby, screenCreate, screenVoting, screenResult, screenGameOver].forEach(s => s.style.display = 'none');
    screenToShow.style.display = 'block';
}
function clearImagePreview() {
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
    imageInput.value = '';
    imagePreview.style.display = 'none';
    imagePreview.src = '';
    if (customButton)
        customButton.innerText = 'Bild auswählen';
}
function renderScoreList(target, players) {
    target.innerHTML = '';
    [...players].sort((a, b) => b.score - a.score).forEach((p, index) => {
        const li = document.createElement('li');
        li.className = `score-item ${index === 0 ? 'leader' : ''}`;
        const playerInfo = document.createElement('div');
        playerInfo.className = 'player-info';
        const rankBadge = document.createElement('span');
        rankBadge.className = 'rank-badge';
        rankBadge.innerText = `#${index + 1}`;
        const name = document.createElement('span');
        name.className = 'player-name';
        name.innerText = p.name;
        const score = document.createElement('span');
        score.className = 'score-badge';
        score.innerText = `${p.score} Pkt.`;
        playerInfo.append(rankBadge, name);
        li.append(playerInfo, score);
        target.appendChild(li);
    });
}
function renderLobbyPlayers(players) {
    lobbyPlayerList.innerHTML = '';
    players.forEach((player, index) => {
        const li = document.createElement('li');
        li.className = 'score-item';
        const playerInfo = document.createElement('div');
        playerInfo.className = 'player-info';
        const rankBadge = document.createElement('span');
        rankBadge.className = 'rank-badge';
        rankBadge.innerText = `${index + 1}`;
        const name = document.createElement('span');
        name.className = 'player-name';
        name.innerText = player.id === currentHostId ? `${player.name} (Host)` : player.name;
        playerInfo.append(rankBadge, name);
        li.appendChild(playerInfo);
        lobbyPlayerList.appendChild(li);
    });
}
function showRoomNotice(message) {
    roomNotice.innerText = message;
    roomNotice.style.display = 'block';
    if (noticeTimeout)
        window.clearTimeout(noticeTimeout);
    noticeTimeout = window.setTimeout(() => {
        roomNotice.style.display = 'none';
    }, 5000);
}
function renderStats(players) {
    statsList.innerHTML = '';
    if (players.length === 0) {
        statsNotice.innerText = 'Noch keine gespeicherten Runden vorhanden.';
        return;
    }
    statsNotice.innerText = 'Gespeicherte Gesamtwertung ueber alle Spiele.';
    players.forEach((player, index) => {
        const li = document.createElement('li');
        li.className = `score-item ${index === 0 ? 'leader' : ''}`;
        const playerInfo = document.createElement('div');
        playerInfo.className = 'player-info';
        const rankBadge = document.createElement('span');
        rankBadge.className = 'rank-badge';
        rankBadge.innerText = `#${index + 1}`;
        const name = document.createElement('span');
        name.className = 'player-name';
        name.innerText = player.name;
        const details = document.createElement('span');
        details.className = 'stat-details';
        details.innerText = `${player.gamesPlayed} Spiele · ${player.roundsCreated} Runden · Ø Vote ${player.averageVoteGiven}`;
        const score = document.createElement('span');
        score.className = 'score-badge';
        score.innerText = `${player.totalScore} Pkt.`;
        playerInfo.append(rankBadge, name, details);
        li.append(playerInfo, score);
        statsList.appendChild(li);
    });
}
// --- LOBBY ACTIONS ---
function triggerNameError() {
    lobbyError.innerText = '⚠️ Bitte gib zuerst einen Spielernamen ein!';
    usernameInput.classList.add('input-error');
    usernameInput.focus();
}
usernameInput.addEventListener('input', () => {
    if (usernameInput.value.trim().length > 0) {
        lobbyError.innerText = '';
        usernameInput.classList.remove('input-error');
    }
});
function loadGameConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield fetch('/api/config');
            if (!response.ok)
                return;
            const config = yield response.json();
            aiRoundLimit = Math.max(Number(config.aiRoundLimit) || 5, 1);
            roundCountInput.max = String(aiRoundLimit);
            roundCountInput.value = String(Math.min(Number(roundCountInput.value) || aiRoundLimit, aiRoundLimit));
            roundLimitHint.innerText = `Maximal ${aiRoundLimit} Runden pro Spiel, passend zum aktuellen KI-Limit.`;
        }
        catch (_a) {
            roundLimitHint.innerText = 'Maximal 5 Runden pro Spiel.';
        }
    });
}
void loadGameConfig();
createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const maxRounds = Math.min(Math.max(Number(roundCountInput.value) || aiRoundLimit, 1), aiRoundLimit);
    if (!username)
        return triggerNameError();
    socket.emit('createRoom', { username, maxRounds, sessionId: createSessionId() });
});
joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!username)
        return triggerNameError();
    if (!code) {
        lobbyError.innerText = '⚠️ Bitte gib einen 4-stelligen Raumcode ein!';
        roomCodeInput.classList.add('input-error');
        roomCodeInput.focus();
        return;
    }
    socket.emit('joinRoom', { roomId: code, username, sessionId: createSessionId() });
});
function enterRoom(roomId, sessionId) {
    saveSession(roomId, sessionId);
    displayRoomCode.innerText = roomId;
    gameHeader.style.display = 'block';
    showScreen(screenRoomLobby);
}
socket.on('roomCreated', (data) => enterRoom(data.roomId, data.sessionId));
socket.on('joinedSuccess', (data) => enterRoom(data.roomId, data.sessionId));
socket.on('resumeSuccess', (data) => {
    enterRoom(data.roomId, data.sessionId);
    showRoomNotice('Verbindung wiederhergestellt.');
});
socket.on('resumeFailed', () => {
    clearSession();
    gameHeader.style.display = 'none';
    showScreen(screenLobby);
});
socket.on('roomDataUpdate', (data) => {
    playerCount.innerText = data.playerCount.toString();
    roundCounter.innerText = `${data.currentRound}/${data.maxRounds}`;
    currentHostId = data.hostId;
    if (data.gameState === 'LOBBY') {
        const isHost = socket.id === data.hostId;
        renderLobbyPlayers(data.players);
        hostNotice.innerText = isHost
            ? 'Alle bereit? Starte die Partie, sobald genug Spieler im Raum sind.'
            : 'Warte darauf, dass der Host die Partie startet.';
        startGameButton.style.display = isHost ? 'block' : 'none';
        showScreen(screenRoomLobby);
    }
});
socket.on('errorMsg', (msg) => {
    if (screenLobby.style.display !== 'none') {
        lobbyError.innerText = msg;
    }
    else {
        alert(msg);
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
        loadingSection.style.display = 'none';
    }
});
startGameButton.addEventListener('click', () => {
    socket.emit('startGame', { roomId: currentRoomId || displayRoomCode.innerText });
});
statsButton.addEventListener('click', () => __awaiter(void 0, void 0, void 0, function* () {
    showScreen(screenStats);
    statsNotice.innerText = 'Lade Statistiken...';
    statsList.innerHTML = '';
    try {
        const response = yield fetch('/api/stats');
        if (!response.ok)
            throw new Error('Statistik-Request fehlgeschlagen');
        const data = yield response.json();
        if (!data.databaseEnabled) {
            statsNotice.innerText = 'Keine Datenbank verbunden. Setze DATABASE_URL, um Statistiken zu speichern.';
            return;
        }
        renderStats(data.players);
    }
    catch (_a) {
        statsNotice.innerText = 'Statistiken konnten nicht geladen werden.';
    }
}));
backToLobbyButton.addEventListener('click', () => {
    showScreen(screenLobby);
});
copyRoomCodeButton.addEventListener('click', () => __awaiter(void 0, void 0, void 0, function* () {
    const roomCode = currentRoomId || displayRoomCode.innerText;
    if (!roomCode || roomCode === '----')
        return;
    try {
        yield navigator.clipboard.writeText(roomCode);
        showRoomNotice(`Raumcode ${roomCode} kopiert.`);
    }
    catch (_a) {
        showRoomNotice(`Raumcode: ${roomCode}`);
    }
}));
leaveRoomButton.addEventListener('click', () => {
    if (!currentRoomId)
        return;
    socket.emit('leaveRoom', { roomId: currentRoomId });
});
socket.on('leftRoom', () => {
    clearSession();
    gameHeader.style.display = 'none';
    showScreen(screenLobby);
    showRoomNotice('');
});
socket.on('roomNotice', (message) => {
    showRoomNotice(message);
});
socket.on('connect', () => {
    if (!storedSessionRaw)
        return;
    try {
        const storedSession = JSON.parse(storedSessionRaw);
        if (storedSession.roomId && storedSession.sessionId) {
            socket.emit('resumeRoom', storedSession);
        }
    }
    catch (_a) {
        clearSession();
    }
});
// --- SCREEN 2: ERSTELLEN vs. WARTEN ---
socket.on('showCreateScreen', (data) => {
    showScreen(screenCreate);
    loadingSection.style.display = 'none';
    currentHostId = data.hostId;
    // Formular aufräumen
    clearImagePreview();
    uploadButton.disabled = false;
    uploadButton.innerText = 'KI-Video generieren';
    const isMe = (socket.id === data.activeCreatorId);
    if (isMe) {
        // Dieser Spieler darf erstellen
        creatorControls.style.display = 'block';
        waitControls.style.display = 'none';
    }
    else {
        // Alle anderen müssen warten
        creatorControls.style.display = 'none';
        waitControls.style.display = 'block';
        waitNoticeText.innerText = `${data.activeCreatorName} denkt sich gerade ein Meisterwerk aus...`;
    }
});
imageInput.addEventListener('change', (event) => {
    var _a;
    const target = event.target;
    const file = (_a = target.files) === null || _a === void 0 ? void 0 : _a[0];
    if (file) {
        if (!file.type.startsWith('image/')) {
            alert('Bitte wähle eine Bilddatei aus.');
            clearImagePreview();
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            alert('Das Bild ist zu groß. Bitte nutze maximal 8 MB.');
            clearImagePreview();
            return;
        }
        if (previewObjectUrl)
            URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = URL.createObjectURL(file);
        imagePreview.src = previewObjectUrl;
        imagePreview.style.display = 'block';
        if (customButton)
            customButton.innerText = 'Anderes Bild auswählen';
    }
    else {
        clearImagePreview();
    }
});
uploadButton.addEventListener('click', () => {
    var _a;
    const file = (_a = imageInput.files) === null || _a === void 0 ? void 0 : _a[0];
    const promptText = promptInput.value.trim();
    if (!file)
        return alert('Bitte wähle zuerst ein Bild aus!');
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) {
        alert('Bitte wähle ein gültiges Bild bis maximal 8 MB aus.');
        return;
    }
    if (!promptText) {
        alert('Bitte gib eine Anweisung ein!');
        promptInput.focus();
        return;
    }
    uploadButton.disabled = true;
    uploadButton.innerText = 'Wird hochgeladen...';
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        socket.emit('sendImage', {
            roomId: displayRoomCode.innerText,
            imageBase64: reader.result,
            prompt: promptText
        });
    };
    reader.onerror = () => {
        alert('Das Bild konnte nicht gelesen werden.');
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
    };
});
socket.on('generationStarted', (data) => {
    creatorControls.style.display = 'none';
    waitControls.style.display = 'none';
    loadingSection.style.display = 'block';
    loadingText.innerText = `⏳ ${data.authorName} generiert... (${data.step})`;
});
socket.on('generationProgress', (data) => {
    loadingText.innerText = data.step;
});
// --- SCREEN 3: VOTING ---
socket.on('showVotingScreen', (data) => {
    showScreen(screenVoting);
    votingVideoPlayer.src = data.videoUrl;
    votingVideoPlayer.play().catch(() => { });
    const isMe = (socket.id === data.authorId);
    if (isMe) {
        authorNotice.innerText = '🎬 Das ist dein Video! Die anderen bewerten jetzt...';
        votingActionBox.style.display = 'none';
        votingWaitingBox.style.display = 'block';
        votingStatusText.innerText = 'Warte auf Bewertungen...';
    }
    else {
        authorNotice.innerText = `🎬 Video erstellt von: ${data.authorName}`;
        votingActionBox.style.display = 'block';
        votingWaitingBox.style.display = 'none';
        voteButtons.forEach(btn => btn.disabled = false);
    }
});
socket.on('voteProgress', (data) => {
    votingStatusText.innerText = `Stimmen erhalten: ${data.voted}/${data.total}`;
});
voteButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const points = parseInt(btn.getAttribute('data-points') || '0', 10);
        socket.emit('submitVote', { roomId: displayRoomCode.innerText, points });
        votingActionBox.style.display = 'none';
        votingWaitingBox.style.display = 'block';
        votingStatusText.innerText = `Du hast ${points} Sterne gegeben! Warte auf die anderen...`;
    });
});
// SCREEN 4: ERGEBNISSE & HIGHSCORE
socket.on('showResultsScreen', (data) => {
    showScreen(screenResult);
    const isHost = socket.id === currentHostId;
    resultAuthorName.innerText = `Video von ${data.authorName}`;
    resultPointsSummary.innerText = `+${data.roundPoints} Punkte in dieser Runde`;
    nextRoundButton.style.display = !data.isFinalRound && isHost ? 'block' : 'none';
    nextRoundButton.innerText = `Runde ${data.currentRound + 1} starten`;
    if (!data.isFinalRound && !isHost) {
        showRoomNotice('Warte darauf, dass der Host die nächste Runde startet.');
    }
    renderScoreList(scoreList, data.players);
});
// Nächste Runde triggern (jeder Spieler kann den Button klicken)
nextRoundButton.addEventListener('click', () => {
    socket.emit('startNextRound', { roomId: displayRoomCode.innerText });
});
socket.on('showGameOverScreen', (data) => {
    showScreen(screenGameOver);
    const winner = data.players[0];
    winnerName.innerText = winner ? `${winner.name} gewinnt mit ${winner.score} Punkten` : 'Keine Wertung vorhanden';
    renderScoreList(finalScoreList, data.players);
});
restartButton.addEventListener('click', () => {
    window.location.reload();
});
