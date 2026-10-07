import { initializeAccount, refreshAccount } from './auth';
import { createRealtimeClient, type SocketPayload } from './realtime';
import { statisticsView } from './statistics';
import type { QuotaCapacity } from '../ai/quota';
import type { PlayerStats, StatsOverview, VideoStats } from '../database/types';

const socket = createRealtimeClient(() => currentRoomId);

// Header
const gameHeader = document.getElementById('gameHeader') as HTMLElement;
const displayRoomCode = document.getElementById('displayRoomCode') as HTMLElement;
const playerCount = document.getElementById('playerCount') as HTMLElement;
const roundCounter = document.getElementById('roundCounter') as HTMLElement;
const turnInfo = document.getElementById('turnInfo') as HTMLElement;
const turnCounter = document.getElementById('turnCounter') as HTMLElement;
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
const roomRoundCountInput = document.getElementById('roomRoundCountInput') as HTMLInputElement;
const roomRoundLimitHint = document.getElementById('roomRoundLimitHint') as HTMLElement;
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
const { renderStatsOverview, renderStats, renderVideoStats } = statisticsView({ statsOverview, statsList, statsNotice, videoStatsList, videoStatsNotice });
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
const extendGameButton = document.getElementById('extendGameButton') as HTMLButtonElement;
const extensionQuotaHint = document.getElementById('extensionQuotaHint') as HTMLElement;
interface GameOverData {
    players: { id: string; name: string; score: number; connected?: boolean }[];
    maxRounds: number;
    videoNumber?: number;
    currentRound?: number;
    extensionQuota?: QuotaCapacity;
}
let latestGameOver: GameOverData | undefined;
let extensionPending = false;

let previewObjectUrl: string | null = null;
let currentRoomId = '';
let currentHostId = '';
let currentSessionId = '';
let currentPlayerId = '';
let currentPhaseKey = '';
let lobbyActionPending = false;
let pendingRoomCreation: SocketPayload | null = null;
let noticeTimeout: number | undefined;

function createRoomCode() {
    return createSessionId().replace(/-/g, '').slice(-4).toUpperCase();
}

function isCurrentSocket(socketId: string) {
    return (currentPlayerId || socket.id) === socketId;
}

async function connectToRoom(roomId: string) {
    try {
        await socket.connectToRoom(roomId);
        return true;
    } catch (error) {
        lobbyError.innerText = error instanceof Error ? error.message : 'Verbindung zum Raum fehlgeschlagen.';
        return false;
    }
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

function clearSession(preserveStored = false) {
    currentRoomId = '';
    currentSessionId = '';
    currentPlayerId = '';
    currentPhaseKey = '';
    socket.disconnectFromRoom();
    if (!preserveStored) localStorage.removeItem('slopurself-session');
}

// --- SCREEN SWITCHER ---
function showScreen(screenToShow: HTMLElement) {
    if (screenToShow !== screenVoting) votingVideoPlayer.pause();
    if (screenToShow !== screenStats) videoStatsList.querySelectorAll('video').forEach(video => video.pause());
    [document.getElementById('screenStartup')!, document.getElementById('screenAuth')!, screenLobby, screenStats, screenRoomLobby, screenCreate, screenVoting, screenResult, screenGameOver].forEach(s => s.style.display = 'none');
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

function quotaHint(quota: QuotaCapacity, additional = false) {
    const limit = quota.aiRoundLimit;
    if (quota.quotaMode === 'unavailable') return 'Rundenlimit momentan nicht verfügbar.';
    const roundLabel = `${additional ? 'Zusatzrunde' : 'Runde'}${limit === 1 ? '' : 'n'}`;
    return `${additional ? 'Noch' : 'Aktuell'} maximal ${limit} ${roundLabel}.`;
}

function refreshQuota() {
    if (currentRoomId && (screenRoomLobby.style.display !== 'none' || (screenGameOver.style.display !== 'none' && isCurrentSocket(currentHostId)))) socket.emit('refreshQuota', { roomId: currentRoomId });
}
window.setInterval(refreshQuota, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshQuota(); void refreshAccount(); } });
roomRoundCountInput.addEventListener('change', () => {
    if (currentRoomId && !roomRoundCountInput.disabled) socket.emit('setRoundCount', { roomId: currentRoomId, rounds: Number(roomRoundCountInput.value) });
});

function setLobbyPending(pending: boolean) {
    lobbyActionPending = pending;
    createRoomButton.disabled = pending;
    joinRoomButton.disabled = pending;
}
async function requestCreateRoom() {
    if (!pendingRoomCreation) return;
    const roomId = socket.isNativeWebSocket ? createRoomCode() : '';
    if (!(await connectToRoom(roomId))) { setLobbyPending(false); return; }
    socket.emit('createRoom', { ...pendingRoomCreation, roomId });
}
createRoomButton.addEventListener('click', async () => {
    if (lobbyActionPending) return;
    const username = usernameInput.value.trim();
    if (!username) return triggerNameError();
    clearSession();
    pendingRoomCreation = { username, maxRounds: 1, sessionId: createSessionId() };
    setLobbyPending(true);
    await requestCreateRoom();
});
socket.on('roomCodeConflict', () => { void requestCreateRoom(); });
joinRoomButton.addEventListener('click', async () => {
    if (lobbyActionPending) return;
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!username) return triggerNameError();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
        lobbyError.innerText = 'Bitte gib einen 4-stelligen Raumcode ein.';
        roomCodeInput.focus(); return;
    }
    clearSession();
    setLobbyPending(true);
    if (!(await connectToRoom(code))) { setLobbyPending(false); return; }
    socket.emit('joinRoom', { roomId: code, username, sessionId: createSessionId() });
});

function enterRoom(roomId: string, sessionId: string, playerId?: string) {
    setLobbyPending(false);
    pendingRoomCreation = null;
    currentPlayerId = playerId || socket.id;
    saveSession(roomId, sessionId);
    displayRoomCode.innerText = roomId;
    gameHeader.style.display = 'block';
    showScreen(screenRoomLobby);
}
socket.on('roomCreated', data => enterRoom(data.roomId, data.sessionId, data.playerId));
socket.on('joinedSuccess', data => enterRoom(data.roomId, data.sessionId, data.playerId));
socket.on('resumeSuccess', data => {
    enterRoom(data.roomId, data.sessionId, data.playerId);
    showRoomNotice('Verbindung wiederhergestellt.');
});
socket.on('resumeFailed', () => {
    clearSession(); setLobbyPending(false);
    gameHeader.style.display = 'none';
    showScreen(screenLobby);
    lobbyError.innerText = 'Deine vorige Sitzung ist nicht mehr verfuegbar.';
});
socket.on('sessionReplaced', () => {
    clearSession(true); gameHeader.style.display = 'none'; showScreen(screenLobby);
    lobbyError.innerText = 'Diese Sitzung wurde in einem anderen Tab geoeffnet.';
});
socket.on('disconnect', () => {
    extensionPending = false;
    extendGameButton.disabled = true;
    if (currentRoomId) showRoomNotice('Verbindung unterbrochen. Verbinde erneut...');
});

function showCreateState(data: { activeCreatorId?: string; activeCreatorName?: string; hostId: string; gameState?: string; reset?: boolean }) {
    showScreen(screenCreate);
    currentHostId = data.hostId;
    if (data.reset) { clearImagePreview(); promptInput.value = ''; }
    uploadButton.disabled = false;
    uploadButton.innerText = 'KI-Video generieren';

    const isGenerating = data.gameState === 'GENERATING';
    const isMe = Boolean(data.activeCreatorId) && isCurrentSocket(data.activeCreatorId || '');

    creatorControls.style.display = !isGenerating && isMe ? 'block' : 'none';
    waitControls.style.display = !isGenerating && !isMe ? 'block' : 'none';
    loadingSection.style.display = isGenerating ? 'block' : 'none';
    waitNoticeText.innerText = `${data.activeCreatorName || 'Ein Spieler'} denkt sich gerade ein Meisterwerk aus...`;
    loadingText.innerText = `⏳ ${data.activeCreatorName || 'Ein Spieler'} generiert gerade ein Video...`;
}

function showVotingState(data: { videoUrl?: string; authorId?: string; authorName?: string; hasVoted?: boolean; voted?: number; total?: number }) {
    if (!data.videoUrl) return;
    const entering = screenVoting.style.display === 'none';
    showScreen(screenVoting);
    const newVideo = votingVideoPlayer.getAttribute('src') !== data.videoUrl;
    if (newVideo) votingVideoPlayer.src = data.videoUrl;
    if (entering || newVideo) {
        votingVideoPlayer.currentTime = 0;
        votingVideoPlayer.play().catch(() => {});
    }

    const isMe = Boolean(data.authorId) && isCurrentSocket(data.authorId || '');

    if (isMe || data.hasVoted) {
        authorNotice.innerText = isMe ? 'Das ist dein Video!' : `Video von: ${data.authorName || 'Spieler'}`;
        votingActionBox.style.display = 'none';
        votingWaitingBox.style.display = 'block';
        votingStatusText.innerText = data.total === 0 ? 'Solo-Test: Vorschau, danach Ergebnis ohne Bewertung.' : `${data.hasVoted ? 'Bewertung gespeichert. ' : ''}Stimmen: ${data.voted || 0}/${data.total || 0}`;
    } else {
        authorNotice.innerText = `🎬 Video erstellt von: ${data.authorName || 'Spieler'}`;
        votingActionBox.style.display = 'block';
        votingWaitingBox.style.display = 'none';
        voteButtons.forEach(btn => btn.disabled = false);
    }
}

socket.on('roomDataUpdate', (data: {
    playerCount: number;
    players: { id: string; name: string; score: number; connected?: boolean }[];
    hostId: string;
    gameState: string;
    currentRound: number;
    maxRounds: number;
    turnNumber?: number;
    turnCount?: number;
    nextRound?: number;
    quota?: QuotaCapacity;
    extensionQuota?: QuotaCapacity;
    videoNumber?: number;
    activeCreatorId?: string;
    activeCreatorName?: string;
    currentVideoUrl?: string;
    roomId?: string;
    votedPlayerIds?: string[];
    lastResult?: { authorName: string; roundPoints: number };
}) => {
    if (!currentRoomId || (data.roomId && data.roomId !== currentRoomId)) return;
    const phaseKey = `${currentRoomId}:${data.currentRound}:${data.activeCreatorId}`;
    const phaseChanged = phaseKey !== currentPhaseKey;
    currentPhaseKey = phaseKey;
    playerCount.innerText = data.playerCount.toString();
    roundCounter.innerText = data.gameState === 'LOBBY' ? String(data.maxRounds) : `${data.currentRound}/${data.maxRounds}`;
    turnInfo.style.display = data.turnCount ? '' : 'none';
    turnCounter.innerText = `${data.turnNumber || 1}/${data.turnCount || 1}`;
    if (currentHostId !== data.hostId || data.gameState !== 'GAME_OVER') extensionPending = false;
    currentHostId = data.hostId;

    if (data.gameState === 'LOBBY') {
        const isHost = isCurrentSocket(data.hostId);
        renderLobbyPlayers(data.players);
        hostNotice.innerText = isHost
            ? 'Alle bereit? Starte die Partie, sobald genug Spieler im Raum sind.'
            : 'Warte darauf, dass der Host die Partie startet.';
        startGameButton.style.display = isHost ? 'block' : 'none';
        startGameButton.disabled = !data.quota?.aiRoundLimit;
        roomRoundCountInput.disabled = !isHost || !data.quota?.aiRoundLimit;
        roomRoundCountInput.min = data.quota?.aiRoundLimit ? '1' : '0';
        roomRoundCountInput.max = String(data.quota?.aiRoundLimit || 0);
        roomRoundCountInput.value = String(data.maxRounds);
        roomRoundLimitHint.innerText = data.quota ? quotaHint(data.quota) : 'Rundenlimit wird geprüft.';
        showScreen(screenRoomLobby);
    } else if (data.gameState === 'IDLE' || data.gameState === 'GENERATING') {
        showCreateState({ ...data, reset: phaseChanged && data.gameState === 'IDLE' });
    } else if (data.gameState === 'VOTING') {
        showVotingState({
            videoUrl: data.currentVideoUrl,
            authorId: data.activeCreatorId,
            authorName: data.activeCreatorName,
            hasVoted: data.votedPlayerIds?.includes(currentPlayerId),
            voted: data.votedPlayerIds?.length || 0,
            total: data.players.length - 1
        });
    } else if (data.gameState === 'RESULTS') {
        showResultsState({ ...data, authorName: data.lastResult?.authorName || data.activeCreatorName || 'Spieler', roundPoints: data.lastResult?.roundPoints || 0, isFinalRound: false });
    } else if (data.gameState === 'GAME_OVER') {
        showGameOverState({ ...data, players: [...data.players].sort((a, b) => b.score - a.score) });
    }
});

socket.on('errorMsg', (msg: string) => {
    setLobbyPending(false);
    extensionPending = false;
    if (latestGameOver && screenGameOver.style.display !== 'none') showGameOverState(latestGameOver);
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
            archive?: { usedBytes: number; maxBytes: number; videoCount: number };
        };

        if (!data.databaseEnabled) {
            statsNotice.innerText = 'Statistiken sind momentan nicht verfuegbar.';
            return;
        }

        renderStatsOverview(data.overview);
        renderStats(data.players);
        renderVideoStats(data.recentVideos, data.videoStorageMode);
        document.getElementById('archiveUsage')!.innerText = data.archive ? `${data.archive.videoCount} archivierte Videos · ${(data.archive.usedBytes / 1024 / 1024).toFixed(1)} / ${Math.round(data.archive.maxBytes / 1024 / 1024)} MB` : '';
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
    roomNotice.style.display = 'none';
});

socket.on('roomNotice', (message: string) => {
    showRoomNotice(message);
});

async function resumeStoredSession() {
    try {
        const stored = JSON.parse(localStorage.getItem('slopurself-session') || 'null') as { roomId?: string; sessionId?: string } | null;
        if (!stored?.roomId || !stored.sessionId) return;
        currentRoomId = stored.roomId;
        currentSessionId = stored.sessionId;
        if (socket.isNativeWebSocket) { await connectToRoom(stored.roomId); }
        else socket.emit('resumeRoom', { roomId: stored.roomId, sessionId: stored.sessionId });
    } catch { clearSession(); }
}
socket.on('connect', () => {
    if (socket.isNativeWebSocket) {
        if (currentRoomId && currentSessionId) socket.emit('resumeRoom', { roomId: currentRoomId, sessionId: currentSessionId });
    } else void resumeStoredSession();
});
// Session restoration starts only after the account cookie is available.

// --- SCREEN 2: ERSTELLEN vs. WARTEN ---
socket.on('showCreateScreen', (data: { activeCreatorId: string; activeCreatorName: string; hostId: string }) => {
    showCreateState(data);
});

customButton.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); imageInput.click(); }
});

votingVideoPlayer.addEventListener('error', () => {
    if (votingVideoPlayer.getAttribute('src')) showRoomNotice('Das Video konnte nicht geladen werden. Der Video-Link ist eventuell abgelaufen.');
});

imageInput.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
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
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
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
    const uploadRoomId = currentRoomId;
    const uploadTurnKey = currentPhaseKey;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        if (currentRoomId !== uploadRoomId || currentPhaseKey !== uploadTurnKey) return;
        socket.emit('sendImage', {
            roomId: uploadRoomId,
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
    showScreen(screenCreate);
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
    showVotingState(data);
});

socket.on('voteProgress', (data: { voted: number; total: number }) => {
    votingStatusText.innerText = `Stimmen erhalten: ${data.voted}/${data.total}`;
});

voteButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const points = parseInt(btn.getAttribute('data-points') || '0', 10);
        socket.emit('submitVote', { roomId: displayRoomCode.innerText, points });

        voteButtons.forEach(button => button.disabled = true);
        votingActionBox.style.display = 'none';
        votingWaitingBox.style.display = 'block';
        votingStatusText.innerText = `Du hast ${points} Sterne gegeben! Warte auf die anderen...`;
    });
});

// SCREEN 4: ERGEBNISSE & HIGHSCORE
function showResultsState(data: { authorName: string; roundPoints: number; players: { id: string; name: string; score: number }[]; currentRound: number; maxRounds: number; nextRound?: number; isFinalRound: boolean }) {
    showScreen(screenResult);
    const isHost = isCurrentSocket(currentHostId);

    resultAuthorName.innerText = `Video von ${data.authorName}`;
    resultPointsSummary.innerText = `+${data.roundPoints} Punkte für dieses Video`;
    nextRoundButton.style.display = !data.isFinalRound && isHost ? 'block' : 'none';
    nextRoundButton.innerText = data.nextRound === data.currentRound ? 'Nächstes Video' : `Runde ${data.nextRound || data.currentRound + 1} starten`;
    if (!data.isFinalRound && !isHost) {
        showRoomNotice('Warte darauf, dass der Host die nächste Runde startet.');
    }

    renderScoreList(scoreList, data.players);
}
socket.on('showResultsScreen', showResultsState);

// Nächste Runde triggern (jeder Spieler kann den Button klicken)
nextRoundButton.addEventListener('click', () => {
    socket.emit('startNextRound', { roomId: displayRoomCode.innerText });
});

function showGameOverState(data: GameOverData) {
    latestGameOver = data;
    if (roomNotice.innerText === 'Warte darauf, dass der Host die nächste Runde startet.') roomNotice.style.display = 'none';
    showScreen(screenGameOver);
    const winner = data.players[0];
    const winners = data.players.filter(player => player.score === winner?.score);
    winnerName.innerText = winner ? `${winners.map(p => p.name).join(', ')} ${winners.length > 1 ? 'teilen den Sieg' : 'gewinnt'} mit ${winner.score} Punkten` : 'Keine Wertung vorhanden';
    renderScoreList(finalScoreList, data.players);
    const isHost = isCurrentSocket(currentHostId);
    const quota = data.extensionQuota;
    const disconnected = data.players.some(player => player.connected === false);
    extendGameButton.style.display = isHost ? 'block' : 'none';
    extendGameButton.disabled = extensionPending || !quota?.aiRoundLimit || disconnected;
    extendGameButton.innerText = extensionPending ? 'Bitte warten...' : 'Zusatzrunde spielen';
    extensionQuotaHint.innerText = !quota ? 'Rundenlimit wird geprüft.'
        : disconnected ? 'Warte auf die Wiederverbindung aller Spieler.' : quotaHint(quota, true);
}
socket.on('showGameOverScreen', showGameOverState);

extendGameButton.addEventListener('click', () => {
    if (!latestGameOver || extendGameButton.disabled || !currentRoomId) return;
    extensionPending = true;
    showGameOverState(latestGameOver);
    socket.emit('extendGame', { roomId: currentRoomId, completedVideo: latestGameOver.videoNumber || latestGameOver.currentRound });
});

restartButton.addEventListener('click', () => {
    if (currentRoomId) {
        socket.emit('leaveRoom', { roomId: currentRoomId });
    }
});

socket.on('authExpired', () => { void refreshAccount(); showRoomNotice('Anmeldung wird erneuert. Bitte die Aktion erneut ausführen.'); });
void initializeAccount({
    signedIn: async name => {
        if (name) usernameInput.value = name.slice(0, 15);
        usernameInput.type = name ? 'hidden' : 'text';
        showScreen(screenLobby);
        if (socket.isNativeWebSocket) await resumeStoredSession(); else await socket.connectToRoom('');
    },
    signedOut: async () => {
        if (currentRoomId) { socket.emit('leaveRoom', { roomId: currentRoomId }); await new Promise(resolve => setTimeout(resolve, 200)); }
        clearSession(); gameHeader.style.display = 'none';
    },
    showAuth: () => showScreen(document.getElementById('screenAuth')!),
    refreshToken: token => { if (socket.id) socket.emit('refreshAuth', { token }); }
});
