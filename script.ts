declare const io: () => any;
const socket = io();

// Header
const gameHeader = document.getElementById('gameHeader') as HTMLElement;
const displayRoomCode = document.getElementById('displayRoomCode') as HTMLElement;
const playerCount = document.getElementById('playerCount') as HTMLElement;
const roundCounter = document.getElementById('roundCounter') as HTMLElement;
const copyRoomCodeButton = document.getElementById('copyRoomCodeButton') as HTMLButtonElement;
const leaveRoomButton = document.getElementById('leaveRoomButton') as HTMLButtonElement;
const roomNotice = document.getElementById('roomNotice') as HTMLParagraphElement;

// Screens
const screenLobby = document.getElementById('screenLobby') as HTMLElement;
const screenStats = document.getElementById('screenStats') as HTMLElement;
const screenRoomLobby = document.getElementById('screenRoomLobby') as HTMLElement;
const screenCreate = document.getElementById('screenCreate') as HTMLElement;
const screenVoting = document.getElementById('screenVoting') as HTMLElement;
const screenResult = document.getElementById('screenResult') as HTMLElement;
const screenGameOver = document.getElementById('screenGameOver') as HTMLElement;

// Lobby-Elemente
const usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
const roundCountInput = document.getElementById('roundCountInput') as HTMLInputElement;
const roundLimitHint = document.getElementById('roundLimitHint') as HTMLParagraphElement;
const createRoomButton = document.getElementById('createRoomButton') as HTMLButtonElement;
const joinRoomButton = document.getElementById('joinRoomButton') as HTMLButtonElement;
const statsButton = document.getElementById('statsButton') as HTMLButtonElement;
const backToLobbyButton = document.getElementById('backToLobbyButton') as HTMLButtonElement;
const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement;
const lobbyError = document.getElementById('lobbyError') as HTMLParagraphElement;
const statsNotice = document.getElementById('statsNotice') as HTMLParagraphElement;
const statsOverview = document.getElementById('statsOverview') as HTMLDivElement;
const statsList = document.getElementById('statsList') as HTMLUListElement;
const videoStatsNotice = document.getElementById('videoStatsNotice') as HTMLParagraphElement;
const videoStatsList = document.getElementById('videoStatsList') as HTMLUListElement;
const hostNotice = document.getElementById('hostNotice') as HTMLParagraphElement;
const lobbyPlayerList = document.getElementById('lobbyPlayerList') as HTMLUListElement;
const startGameButton = document.getElementById('startGameButton') as HTMLButtonElement;

// Create / Wait-Elemente
const creatorControls = document.getElementById('creatorControls') as HTMLDivElement;
const waitControls = document.getElementById('waitControls') as HTMLDivElement;
const waitNoticeText = document.getElementById('waitNoticeText') as HTMLParagraphElement;
const imageInput = document.getElementById('imageInput') as HTMLInputElement;
const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;
const promptInput = document.getElementById('promptInput') as HTMLInputElement;
const uploadButton = document.getElementById('uploadButton') as HTMLButtonElement;
const customButton = document.querySelector('.custom-file-btn') as HTMLLabelElement;
const loadingSection = document.getElementById('loadingSection') as HTMLDivElement;
const loadingText = document.getElementById('loadingText') as HTMLParagraphElement;

// Voting-Elemente
const authorNotice = document.getElementById('authorNotice') as HTMLParagraphElement;
const votingVideoPlayer = document.getElementById('votingVideoPlayer') as HTMLVideoElement;
const votingActionBox = document.getElementById('votingActionBox') as HTMLDivElement;
const votingWaitingBox = document.getElementById('votingWaitingBox') as HTMLDivElement;
const votingStatusText = document.getElementById('votingStatusText') as HTMLParagraphElement;
const voteButtons = document.querySelectorAll('.voteBtn') as NodeListOf<HTMLButtonElement>;

// Result-Elemente
const resultAuthorName = document.getElementById('resultAuthorName') as HTMLElement;
const resultPointsSummary = document.getElementById('resultPointsSummary') as HTMLParagraphElement;
const scoreList = document.getElementById('scoreList') as HTMLUListElement;
const nextRoundButton = document.getElementById('nextRoundButton') as HTMLButtonElement;
const winnerName = document.getElementById('winnerName') as HTMLElement;
const finalScoreList = document.getElementById('finalScoreList') as HTMLUListElement;
const restartButton = document.getElementById('restartButton') as HTMLButtonElement;

let previewObjectUrl: string | null = null;
let currentRoomId = '';
let currentHostId = '';
let currentSessionId = '';
let aiRoundLimit = 5;
let noticeTimeout: number | undefined;
const storedSessionRaw = localStorage.getItem('slopurself-session');

interface PlayerStats {
    name: string;
    gamesPlayed: number;
    wins: number;
    roundsCreated: number;
    totalScore: number;
    averageScore: number;
    averageReceivedPoints: number;
    votesGiven: number;
    averageVoteGiven: number;
}

interface StatsOverview {
    gamesPlayed: number;
    completedGames: number;
    roundsPlayed: number;
    votesCast: number;
    videosArchived: number;
    highestScore: number;
}

interface VideoStats {
    roomCode: string;
    roundNumber: number;
    creatorName: string;
    prompt: string;
    videoUrl: string;
    roundPoints: number;
    createdAt: string;
}

function createSessionId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveSession(roomId: string, sessionId: string) {
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
function showScreen(screenToShow: HTMLElement) {
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
    if (customButton) customButton.innerText = 'Bild auswählen';
}

function renderScoreList(target: HTMLUListElement, players: { id: string; name: string; score: number }[]) {
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

function renderLobbyPlayers(players: { id: string; name: string; score: number }[]) {
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

function showRoomNotice(message: string) {
    roomNotice.innerText = message;
    roomNotice.style.display = 'block';

    if (noticeTimeout) window.clearTimeout(noticeTimeout);
    noticeTimeout = window.setTimeout(() => {
        roomNotice.style.display = 'none';
    }, 5000);
}

function renderStatsOverview(overview: StatsOverview) {
    statsOverview.innerHTML = '';

    const items = [
        { label: 'Spiele', value: overview.gamesPlayed },
        { label: 'Beendet', value: overview.completedGames },
        { label: 'Runden', value: overview.roundsPlayed },
        { label: 'Votes', value: overview.votesCast },
        { label: 'Videos', value: overview.videosArchived },
        { label: 'Topscore', value: overview.highestScore }
    ];

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'stat-card';

        const value = document.createElement('strong');
        value.innerText = String(item.value);

        const label = document.createElement('span');
        label.innerText = item.label;

        card.append(value, label);
        statsOverview.appendChild(card);
    });
}

function renderStats(players: PlayerStats[]) {
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
        details.innerText = `${player.gamesPlayed} Spiele · ${player.wins} Siege · ${player.roundsCreated} Videos · Ø ${player.averageReceivedPoints} Pkt./Video · Ø Vote ${player.averageVoteGiven}`;

        const score = document.createElement('span');
        score.className = 'score-badge';
        score.innerText = `${player.totalScore} Pkt.`;

        playerInfo.append(rankBadge, name, details);
        li.append(playerInfo, score);
        statsList.appendChild(li);
    });
}

function renderVideoStats(videos: VideoStats[], videoStorageMode: string) {
    videoStatsList.innerHTML = '';

    if (videos.length === 0) {
        videoStatsNotice.innerText = 'Noch keine Videos gespeichert.';
        return;
    }

    videoStatsNotice.innerText = videoStorageMode === 'url'
        ? 'Videos werden platzsparend als Link zur gespielten Runde gespeichert.'
        : 'Gespeicherte Videos aus den letzten Runden.';

    videos.forEach(video => {
        const li = document.createElement('li');
        li.className = 'video-stat-item';

        const videoElement = document.createElement('video');
        videoElement.controls = true;
        videoElement.preload = 'metadata';
        videoElement.src = video.videoUrl;

        const meta = document.createElement('div');
        meta.className = 'video-stat-meta';

        const title = document.createElement('strong');
        title.innerText = `${video.creatorName} · Raum ${video.roomCode} · Runde ${video.roundNumber}`;

        const prompt = document.createElement('span');
        prompt.innerText = video.prompt;

        const points = document.createElement('small');
        points.innerText = `${video.roundPoints} Punkte · ${new Date(video.createdAt).toLocaleDateString('de-DE')}`;

        meta.append(title, prompt, points);
        li.append(videoElement, meta);
        videoStatsList.appendChild(li);
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

async function loadGameConfig() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) return;

        const config = await response.json() as { aiRoundLimit: number; mockAi: boolean };
        aiRoundLimit = Math.max(Number(config.aiRoundLimit) || 5, 1);
        roundCountInput.max = String(aiRoundLimit);
        roundCountInput.value = String(Math.min(Number(roundCountInput.value) || aiRoundLimit, aiRoundLimit));
        roundLimitHint.innerText = `Maximal ${aiRoundLimit} Runden pro Spiel, passend zum aktuellen KI-Limit.`;
    } catch {
        roundLimitHint.innerText = 'Maximal 5 Runden pro Spiel.';
    }
}

void loadGameConfig();

createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const maxRounds = Math.min(Math.max(Number(roundCountInput.value) || aiRoundLimit, 1), aiRoundLimit);
    if (!username) return triggerNameError();
    socket.emit('createRoom', { username, maxRounds, sessionId: createSessionId() });
});

joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!username) return triggerNameError();
    if (!code) {
        lobbyError.innerText = '⚠️ Bitte gib einen 4-stelligen Raumcode ein!';
        roomCodeInput.classList.add('input-error');
        roomCodeInput.focus();
        return;
    }
    socket.emit('joinRoom', { roomId: code, username, sessionId: createSessionId() });
});

function enterRoom(roomId: string, sessionId: string) {
    saveSession(roomId, sessionId);
    displayRoomCode.innerText = roomId;
    gameHeader.style.display = 'block';
    showScreen(screenRoomLobby);
}

socket.on('roomCreated', (data: { roomId: string; sessionId: string }) => enterRoom(data.roomId, data.sessionId));
socket.on('joinedSuccess', (data: { roomId: string; sessionId: string }) => enterRoom(data.roomId, data.sessionId));
socket.on('resumeSuccess', (data: { roomId: string; sessionId: string; gameState: string }) => {
    enterRoom(data.roomId, data.sessionId);
    showRoomNotice('Verbindung wiederhergestellt.');
});
socket.on('resumeFailed', () => {
    clearSession();
    gameHeader.style.display = 'none';
    showScreen(screenLobby);
});

socket.on('roomDataUpdate', (data: { playerCount: number; players: { id: string; name: string; score: number }[]; hostId: string; gameState: string; currentRound: number; maxRounds: number }) => {
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

socket.on('errorMsg', (msg: string) => {
    if (screenLobby.style.display !== 'none') {
        lobbyError.innerText = msg;
    } else {
        alert(msg);
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
        loadingSection.style.display = 'none';
    }
});

startGameButton.addEventListener('click', () => {
    socket.emit('startGame', { roomId: currentRoomId || displayRoomCode.innerText });
});

statsButton.addEventListener('click', async () => {
    showScreen(screenStats);
    statsNotice.innerText = 'Lade Statistiken...';
    statsOverview.innerHTML = '';
    statsList.innerHTML = '';
    videoStatsNotice.innerText = '';
    videoStatsList.innerHTML = '';

    try {
        const response = await fetch('/api/stats');
        if (!response.ok) throw new Error('Statistik-Request fehlgeschlagen');

        const data = await response.json() as {
            databaseEnabled: boolean;
            overview: StatsOverview;
            players: PlayerStats[];
            recentVideos: VideoStats[];
            videoStorageMode: string;
        };

        if (!data.databaseEnabled) {
            statsNotice.innerText = 'Keine Datenbank verbunden. Setze DATABASE_URL, um Statistiken zu speichern.';
            return;
        }

        renderStatsOverview(data.overview);
        renderStats(data.players);
        renderVideoStats(data.recentVideos, data.videoStorageMode);
    } catch {
        statsNotice.innerText = 'Statistiken konnten nicht geladen werden.';
    }
});

backToLobbyButton.addEventListener('click', () => {
    showScreen(screenLobby);
});

copyRoomCodeButton.addEventListener('click', async () => {
    const roomCode = currentRoomId || displayRoomCode.innerText;
    if (!roomCode || roomCode === '----') return;

    try {
        await navigator.clipboard.writeText(roomCode);
        showRoomNotice(`Raumcode ${roomCode} kopiert.`);
    } catch {
        showRoomNotice(`Raumcode: ${roomCode}`);
    }
});

leaveRoomButton.addEventListener('click', () => {
    if (!currentRoomId) return;
    socket.emit('leaveRoom', { roomId: currentRoomId });
});

socket.on('leftRoom', () => {
    clearSession();
    gameHeader.style.display = 'none';
    showScreen(screenLobby);
    showRoomNotice('');
});

socket.on('roomNotice', (message: string) => {
    showRoomNotice(message);
});

socket.on('connect', () => {
    if (!storedSessionRaw) return;

    try {
        const storedSession = JSON.parse(storedSessionRaw) as { roomId?: string; sessionId?: string };
        if (storedSession.roomId && storedSession.sessionId) {
            socket.emit('resumeRoom', storedSession);
        }
    } catch {
        clearSession();
    }
});

// --- SCREEN 2: ERSTELLEN vs. WARTEN ---
socket.on('showCreateScreen', (data: { activeCreatorId: string; activeCreatorName: string; hostId: string }) => {
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
    } else {
        // Alle anderen müssen warten
        creatorControls.style.display = 'none';
        waitControls.style.display = 'block';
        waitNoticeText.innerText = `${data.activeCreatorName} denkt sich gerade ein Meisterwerk aus...`;
    }
});

imageInput.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
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

        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = URL.createObjectURL(file);
        imagePreview.src = previewObjectUrl;
        imagePreview.style.display = 'block';
        if (customButton) customButton.innerText = 'Anderes Bild auswählen';
    } else {
        clearImagePreview();
    }
});

uploadButton.addEventListener('click', () => {
    const file = imageInput.files?.[0];
    const promptText = promptInput.value.trim();

    if (!file) return alert('Bitte wähle zuerst ein Bild aus!');
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
            imageBase64: reader.result as string,
            prompt: promptText
        });
    };
    reader.onerror = () => {
        alert('Das Bild konnte nicht gelesen werden.');
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
    };
});

socket.on('generationStarted', (data: { authorName: string; step: string }) => {
    creatorControls.style.display = 'none';
    waitControls.style.display = 'none';
    loadingSection.style.display = 'block';
    loadingText.innerText = `⏳ ${data.authorName} generiert... (${data.step})`;
});

socket.on('generationProgress', (data: { step: string }) => {
    loadingText.innerText = data.step;
});

// --- SCREEN 3: VOTING ---
socket.on('showVotingScreen', (data: { videoUrl: string; authorId: string; authorName: string }) => {
    showScreen(screenVoting);
    votingVideoPlayer.src = data.videoUrl;
    votingVideoPlayer.play().catch(() => {});

    const isMe = (socket.id === data.authorId);

    if (isMe) {
        authorNotice.innerText = '🎬 Das ist dein Video! Die anderen bewerten jetzt...';
        votingActionBox.style.display = 'none';
        votingWaitingBox.style.display = 'block';
        votingStatusText.innerText = 'Warte auf Bewertungen...';
    } else {
        authorNotice.innerText = `🎬 Video erstellt von: ${data.authorName}`;
        votingActionBox.style.display = 'block';
        votingWaitingBox.style.display = 'none';
        voteButtons.forEach(btn => btn.disabled = false);
    }
});

socket.on('voteProgress', (data: { voted: number; total: number }) => {
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
socket.on('showResultsScreen', (data: { authorName: string; roundPoints: number; players: { id: string; name: string; score: number }[]; currentRound: number; maxRounds: number; isFinalRound: boolean }) => {
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

socket.on('showGameOverScreen', (data: { players: { id: string; name: string; score: number }[]; maxRounds: number }) => {
    showScreen(screenGameOver);
    const winner = data.players[0];
    winnerName.innerText = winner ? `${winner.name} gewinnt mit ${winner.score} Punkten` : 'Keine Wertung vorhanden';
    renderScoreList(finalScoreList, data.players);
});

restartButton.addEventListener('click', () => {
    window.location.reload();
});
