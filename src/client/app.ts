import { initializeAccount, refreshAccount } from './auth';
import { ranked } from '../shared/ranking';
import { huggingFaceConnection } from './huggingface';
import { createRealtimeClient, type SocketPayload } from './realtime';
import { statisticsView } from './statistics';
import type { HistoryKind } from './history-selection';
import { historyUndo } from './history-undo';
import { videoPlayback } from './video';
import { accountManagement } from './accounts';
import { prepareImage } from './images';
import { gameVariants, type VariantSnapshot } from './variants';
import { partyControls, type PartySnapshot } from './party';
import { gameOptions } from '../game/options';
import type { QuotaCapacity } from '../ai/quota';
import type { PlayerStats, StatsOverview, VideoStats, RoomStats, VideoCreator } from '../database/types';
import type { HistoryPage } from '../database/pagination';

const socket = createRealtimeClient(() => currentRoomId);
const accounts = accountManagement();
const hfConnection = huggingFaceConnection();
const party = partyControls(() => currentPlayerId, payload => socket.emit('closePhase', { ...payload, roomId: currentRoomId }));
const variants = gameVariants(() => currentRoomId, () => currentPlayerId,
    (event, payload) => socket.emit(event, { ...payload, roomId: currentRoomId }));
const undoVideos = historyUndo(() => loadStatistics(false, true));

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
let editingRoundCount = false;
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
const videoPlayerFilter = document.getElementById('videoPlayerFilter') as HTMLSelectElement;
const statsActionNotice = document.getElementById('statsActionNotice')!;
const roomStatsList = document.getElementById('roomStatsList') as HTMLUListElement;
const moreVideosButton = document.getElementById('moreVideosButton') as HTMLButtonElement;
const moreRoomsButton = document.getElementById('moreRoomsButton') as HTMLButtonElement;
let videoHistory: VideoStats[] = [], roomHistory: RoomStats[] = [];
let videoCursor: string | null = null, roomCursor: string | null = null;
let videoStorageMode = 'archive';
const historyLoading = { videos: false, rooms: false };
const { renderStatsOverview, renderStats, renderVideoStats, renderRooms, resetEditing } = statisticsView({ statsOverview, statsList, statsNotice, videoStatsList, videoStatsNotice,
    roomStatsList, roomStatsNotice: document.getElementById('roomStatsNotice')!, playerFilter: videoPlayerFilter,
    selectCreator: id => { videoPlayerFilter.value = id; void loadStatistics(true); }, deleteItems: deleteSelectedStatistics });
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
const finishPreviewButton = document.getElementById('finishPreviewButton') as HTMLButtonElement;
const votingPlayback = videoPlayback({ video: votingVideoPlayer,
    notice: document.getElementById('videoPlaybackNotice')!, retry: document.getElementById('retryVideoButton') as HTMLButtonElement });
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

let currentRoomId = '';
let currentHostId = '';
let currentSessionId = '';
let currentPlayerId = '';
let spectator = false;
let currentPhaseKey = '';
let lobbyActionPending = false;
let pendingRoomCreation: SocketPayload | null = null;
let noticeTimeout: number | undefined;
let currentVideoNumber = 0;
let statisticsRequest = 0;

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
    document.body.classList.remove('room-open');
    editingRoundCount = false;
    hfConnection.lock(false);
    party.clear();
    currentRoomId = '';
    currentSessionId = '';
    currentPlayerId = '';
    currentPhaseKey = '';
    socket.disconnectFromRoom();
    if (!preserveStored) localStorage.removeItem('slopurself-session');
}

// --- SCREEN SWITCHER ---
function showScreen(screenToShow: HTMLElement) {
    const changed = screenToShow.style.display !== 'block';
    document.getElementById('aboutGame')!.hidden = ![document.getElementById('screenStartup'), document.getElementById('screenAuth'), screenLobby].includes(screenToShow);
    document.body.classList.toggle('statistics-open', screenToShow === screenStats);
    if (screenToShow !== screenStats) accounts.reset();
    if (screenToShow !== screenVoting) votingVideoPlayer.pause();
    if (screenToShow !== screenStats) videoStatsList.querySelectorAll('video').forEach(video => video.pause());
    [document.getElementById('screenStartup')!, document.getElementById('screenAuth')!, screenLobby, screenStats, screenRoomLobby, screenCreate, screenVoting, screenResult, screenGameOver].forEach(s => s.style.display = 'none');
    screenToShow.style.display = 'block';
    if (changed) {
        const heading = screenToShow.querySelector<HTMLElement>('h1, h2, h3');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
}

function clearImagePreview() {
    imageInput.value = '';
    imagePreview.style.display = 'none';
    imagePreview.src = '';
    if (customButton) customButton.innerText = 'Bild auswählen';
}

function renderScoreList(target: HTMLUListElement, players: { id: string; name: string; score: number }[]) {
    target.innerHTML = '';

    ranked(players, p => p.score).forEach(({ item: p, rank }) => {
        const li = document.createElement('li');
        li.className = `score-item ${rank === 1 ? 'leader' : ''}`;

        const playerInfo = document.createElement('div');
        playerInfo.className = 'player-info';

        const rankBadge = document.createElement('span');
        rankBadge.className = 'rank-badge';
        rankBadge.innerText = `#${rank}`;

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

function renderLobbyPlayers(players: { id: string; name: string; score: number; ready?: boolean; connected?: boolean }[]) {
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
        const status = document.createElement('small'); status.textContent = player.connected === false ? 'Getrennt' : player.ready ? 'Bereit' : 'Nicht bereit'; li.append(status);
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
    if (quota.quotaMode === 'unavailable') return quota.sharedQuota === false ? 'Bitte prüft eure HF-Verbindungen.' : 'Rundenlimit momentan nicht verfügbar.';
    const roundLabel = `${additional ? 'Zusatzrunde' : 'Runde'}${limit === 1 ? '' : 'n'}`;
    return `${additional ? 'Noch' : 'Aktuell'} maximal ${limit} ${roundLabel}.`;
}

function refreshQuota() {
    if (currentRoomId && isCurrentSocket(currentHostId) && (screenRoomLobby.style.display !== 'none' || screenGameOver.style.display !== 'none')) socket.emit('refreshQuota', { roomId: currentRoomId });
}
window.setInterval(refreshQuota, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshQuota(); void refreshAccount(); } });
roomRoundCountInput.addEventListener('input', () => { editingRoundCount = true; });
roomRoundCountInput.addEventListener('change', () => {
    editingRoundCount = false;
    if (currentRoomId && !roomRoundCountInput.disabled) socket.emit('setRoundCount', { roomId: currentRoomId, rounds: Number(roomRoundCountInput.value) });
});

function setLobbyPending(pending: boolean) {
    lobbyActionPending = pending;
    createRoomButton.disabled = pending;
    joinRoomButton.disabled = pending;
    (document.getElementById('watchRoomButton') as HTMLButtonElement).disabled = pending;
}
async function requestCreateRoom() {
    if (!pendingRoomCreation) return;
    const roomId = socket.isNativeWebSocket ? createRoomCode() : '';
    if (!(await connectToRoom(roomId))) { setLobbyPending(false); return; }
    socket.emit('createRoom', { ...pendingRoomCreation, roomId });
}
createRoomButton.addEventListener('click', async () => {
    if (lobbyActionPending) return;
    if (!await hfConnection.ensurePlayer()) return;
    if (lobbyActionPending) return;
    const username = usernameInput.value.trim();
    if (!username) return triggerNameError();
    clearSession();
    pendingRoomCreation = { username, maxRounds: 1, sessionId: createSessionId() };
    clearInvitation();
    setLobbyPending(true);
    await requestCreateRoom();
});
socket.on('roomCodeConflict', () => { void requestCreateRoom(); });
async function joinRoom(role: 'player' | 'spectator') {
    if (lobbyActionPending) return;
    if (role === 'player' && !await hfConnection.ensurePlayer()) return;
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
    socket.emit('joinRoom', { roomId: code, username, role, sessionId: createSessionId() });
}
joinRoomButton.addEventListener('click', () => { void joinRoom('player'); });
document.getElementById('watchRoomButton')!.addEventListener('click', () => { void joinRoom('spectator'); });

function enterRoom(roomId: string, sessionId: string, playerId?: string) {
    if (roomId !== currentRoomId) {
        // A rematch gets a new roster. Do not expose the previous room's ready
        // state/host actions while its new WebSocket snapshot is still in flight.
        playerCount.innerText = '0';
        document.getElementById('spectatorCount')!.textContent = '0';
        (document.getElementById('readyInput') as HTMLInputElement).checked = false;
        document.getElementById('readyControl')!.hidden = true;
        startGameButton.disabled = true; startGameButton.style.display = 'none';
        roomRoundCountInput.disabled = true;
        renderLobbyPlayers([]);
        hostNotice.textContent = 'Der Raum wird verbunden …';
    }
    document.body.classList.add('room-open');
    clearInvitation();
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
socket.on('roomTransfer', (data: { roomId: string; sessionId: string; playerId: string }) => {
    if (!/^[A-Z0-9]{4}$/.test(data.roomId)) return;
    enterRoom(data.roomId, data.sessionId, data.playerId);
    currentPhaseKey = ''; latestGameOver = undefined; extensionPending = false;
    if (socket.isNativeWebSocket) void connectToRoom(data.roomId);
});
socket.on('resumeFailed', () => {
    clearSession(); setLobbyPending(false);
    gameHeader.style.display = 'none';
    showScreen(screenLobby);
    lobbyError.innerText = 'Deine vorige Sitzung ist nicht mehr verfügbar.';
});
socket.on('sessionReplaced', () => {
    clearSession(true); gameHeader.style.display = 'none'; showScreen(screenLobby);
    lobbyError.innerText = 'Diese Sitzung wurde in einem anderen Tab geöffnet.';
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

function showVotingState(data: { videoUrl?: string; authorId?: string; authorName?: string; hasVoted?: boolean; hasAbstained?: boolean; previewConfirmed?: boolean; previewDeadline?: number; voted?: number; total?: number }) {
    if (!data.videoUrl) return;
    const entering = screenVoting.style.display === 'none';
    showScreen(screenVoting);
    const newVideo = votingVideoPlayer.getAttribute('src') !== data.videoUrl;
    if (entering || newVideo) votingPlayback.load(data.videoUrl, true);
    const isMe = Boolean(data.authorId) && isCurrentSocket(data.authorId || '');
    finishPreviewButton.hidden = spectator || (!isMe && data.total !== 0) || Boolean(data.previewConfirmed);
    finishPreviewButton.textContent = data.total === 0 ? 'Ergebnis ansehen' : 'Vorschau beenden – Ergebnis freigeben';

    if (spectator || isMe || data.hasVoted) {
        authorNotice.innerText = isMe ? 'Das ist dein Video!' : `Video von: ${data.authorName || 'Spieler'}`;
        votingActionBox.style.display = 'none';
        votingWaitingBox.style.display = 'block';
        votingStatusText.innerText = data.total === 0 ? 'Solo-Vorschau ohne Bewertung.' : `${data.hasAbstained ? 'Enthaltung gespeichert. ' : data.hasVoted ? 'Bewertung gespeichert. ' : ''}Abgaben: ${data.voted || 0}/${data.total || 0}`;
        if (data.total && data.previewDeadline && !data.previewConfirmed) votingStatusText.innerText += isMe ? ' Die Wertung wartet auf deine Vorschau oder Bestätigung, höchstens 45 Sekunden.' : ' Die Vorschau des Erstellers läuft noch (höchstens 45 Sekunden).';
    } else {
        authorNotice.innerText = `🎬 Video erstellt von: ${data.authorName || 'Spieler'}`;
        votingActionBox.style.display = 'block';
        votingWaitingBox.style.display = 'none';
        voteButtons.forEach(btn => btn.disabled = false);
    }
}

socket.on('roomDataUpdate', (data: {
    playerCount: number;
    players: { id: string; name: string; score: number; connected?: boolean; ready?: boolean }[];
    spectators?: { id: string; name: string; connected: boolean }[];
    spectatorCount?: number; startProblem?: string;
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
    lastResult?: { authorName: string; roundPoints: number; abstentions?: number };
} & VariantSnapshot & PartySnapshot & { archiveAuthor?: string }) => {
    if (!currentRoomId || (data.roomId && data.roomId !== currentRoomId)) return;
    spectator = data.role === 'spectator';
    document.getElementById('spectatorRole')!.hidden = !spectator;
    document.getElementById('spectatorCount')!.textContent = String(data.spectatorCount || 0);
    const viewers = document.getElementById('spectatorNames')!;
    viewers.hidden = !data.spectators?.length; viewers.textContent = `Zuschauer: ${(data.spectators || []).map(p => p.name).join(', ')}`;
    hfConnection.lock(!['LOBBY', 'GAME_OVER'].includes(data.gameState));
    const phaseKey = `${currentRoomId}:${data.currentRound}:${data.activeCreatorId}`;
    const phaseChanged = phaseKey !== currentPhaseKey;
    currentPhaseKey = phaseKey;
    playerCount.innerText = data.playerCount.toString();
    roundCounter.innerText = data.gameState === 'LOBBY' ? String(data.maxRounds) : `${data.currentRound}/${data.maxRounds}`;
    turnInfo.style.display = data.turnCount ? '' : 'none';
    turnCounter.innerText = `${data.turnNumber || 1}/${data.turnCount || 1}`;
    if (currentHostId !== data.hostId || data.gameState !== 'GAME_OVER') extensionPending = false;
    currentHostId = data.hostId;
    currentVideoNumber = data.videoNumber || data.currentRound;
    const options = gameOptions(data.options), archiveVote = options.mode === 'archive-vote';
    if (data.gameState !== 'RESULTS' && roomNotice.innerText === 'Warte darauf, dass der Host die nächste Runde startet.') roomNotice.style.display = 'none';

    if (data.gameState === 'LOBBY') {
        const isHost = isCurrentSocket(data.hostId);
        renderLobbyPlayers(data.players);
        hostNotice.innerText = isHost
            ? 'Alle bereit? Starte die Partie, sobald genug Spieler im Raum sind.'
            : 'Warte darauf, dass der Host die Partie startet.';
        startGameButton.style.display = isHost ? 'block' : 'none';
        startGameButton.disabled = Boolean(data.startProblem) || !data.quota?.aiRoundLimit || Boolean(data.options?.sharedImage && !data.sharedImageUrl);
        const ready = document.getElementById('readyInput') as HTMLInputElement;
        document.getElementById('readyControl')!.hidden = spectator;
        ready.checked = data.players.find(p => p.id === currentPlayerId)?.ready === true;
        document.getElementById('readyStatus')!.textContent = data.options?.requireReady ? `${data.players.filter(p => p.ready && p.connected).length}/${data.players.length} bereit. ${data.startProblem || 'Alle Spieler sind bereit.'}` : 'Bereitschaft ist freiwillig.';
        roomRoundCountInput.disabled = !isHost || !data.quota?.aiRoundLimit;
        roomRoundCountInput.min = data.quota?.aiRoundLimit ? '1' : '0';
        roomRoundCountInput.max = String(data.quota?.aiRoundLimit || 0);
        const editingValidCount = editingRoundCount && document.activeElement === roomRoundCountInput && isHost
            && roomRoundCountInput.validity.valid && Boolean(data.quota?.aiRoundLimit);
        if (!editingValidCount) { roomRoundCountInput.value = String(data.maxRounds); editingRoundCount = false; }
        roomRoundLimitHint.innerText = data.quota ? quotaHint(data.quota) : 'Rundenlimit wird geprüft.';
        showScreen(screenRoomLobby);
    } else if (data.gameState === 'IDLE' || data.gameState === 'GENERATING') {
        showCreateState({ ...data, reset: phaseChanged && data.gameState === 'IDLE' });
    } else if (data.gameState === 'VOTING' || data.gameState === 'GUESS_REVIEW') {
        showVotingState({
            videoUrl: data.currentVideoUrl,
            authorId: archiveVote ? undefined : data.activeCreatorId,
            authorName: data.archiveAuthor || data.activeCreatorName,
            hasVoted: data.votedPlayerIds?.includes(currentPlayerId),
            hasAbstained: data.hasAbstained, previewConfirmed: data.previewConfirmed, previewDeadline: data.previewDeadline,
            voted: data.votedPlayerIds?.length || 0,
            total: data.players.length - Number(!archiveVote)
        });
    } else if (data.gameState === 'RESULTS') {
        showResultsState({ ...data, authorName: data.lastResult?.authorName || data.activeCreatorName || 'Spieler', roundPoints: data.lastResult?.roundPoints || 0, abstentions: data.lastResult?.abstentions, isFinalRound: false });
    } else if (data.gameState === 'GAME_OVER') {
        showGameOverState({ ...data, players: [...data.players].sort((a, b) => b.score - a.score) });
    }
    variants.render(data);
    party.render(data);
    if (data.gameState === 'GAME_OVER' && options.mode !== 'classic') {
        extendGameButton.style.display = 'none'; extensionQuotaHint.textContent = 'Archivpartie · keine Änderung der Dauerstatistik';
        if (archiveVote) { winnerName.textContent = 'Best-of · eure Videowertung'; finalScoreList.hidden = true; }
    } else finalScoreList.hidden = false;
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
socket.on('hfRequired', () => {
    setLobbyPending(false);
    uploadButton.disabled = false;
    uploadButton.innerText = 'KI-Video generieren';
    loadingSection.style.display = 'none';
    hfConnection.require();
});

startGameButton.addEventListener('click', () => {
    socket.emit('startGame', { roomId: currentRoomId || displayRoomCode.innerText });
});
document.getElementById('readyInput')!.addEventListener('change', event => socket.emit('setReady', { roomId: currentRoomId, ready: (event.target as HTMLInputElement).checked }));
document.getElementById('rematchGameButton')!.addEventListener('click', () => socket.emit('rematchGame', { roomId: currentRoomId }));

function updateHistoryButtons() {
    const loading = screenStats.hasAttribute('aria-busy');
    for (const [button, kind, cursor] of [[moreVideosButton, 'videos', videoCursor], [moreRoomsButton, 'rooms', roomCursor]] as const) {
        button.hidden = !cursor;
        button.disabled = loading || historyLoading[kind];
        button.textContent = historyLoading[kind] ? 'Wird geladen …' : kind === 'videos' ? 'Mehr Videos laden' : 'Mehr Räume laden';
    }
}
async function historyRequest<T>(kind: HistoryKind, cursor: string, creator: string): Promise<HistoryPage<T>> {
    const params = new URLSearchParams({ cursor });
    if (kind === 'videos' && creator) params.set('player', creator);
    const response = await fetch(`/api/stats/${kind}?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Die Historie konnte nicht geladen werden.');
    return data;
}
async function retainHistory<T>(kind: HistoryKind, items: T[], cursor: string | null, target: number, creator: string, requestId: number) {
    while (cursor && items.length < target && requestId === statisticsRequest) {
        const page = await historyRequest<T>(kind, cursor, creator);
        items.push(...page.items); cursor = page.nextCursor;
    }
    return { items, nextCursor: cursor };
}
async function loadMoreHistory(kind: HistoryKind) {
    const cursor = kind === 'videos' ? videoCursor : roomCursor;
    if (!cursor || historyLoading[kind] || screenStats.hasAttribute('aria-busy')) return;
    const requestId = statisticsRequest, creator = videoPlayerFilter.value;
    historyLoading[kind] = true; updateHistoryButtons(); statsActionNotice.hidden = true;
    try {
        if (kind === 'videos') {
            const page = await historyRequest<VideoStats>(kind, cursor, creator);
            if (requestId !== statisticsRequest || screenStats.style.display === 'none') return;
            const added = page.items.filter(item => !videoHistory.some(video => video.id === item.id));
            videoHistory.push(...added); videoCursor = page.nextCursor;
            renderVideoStats(added, videoStorageMode, true);
        } else {
            const page = await historyRequest<RoomStats>(kind, cursor, creator);
            if (requestId !== statisticsRequest || screenStats.style.display === 'none') return;
            const added = page.items.filter(item => !roomHistory.some(room => room.code === item.code));
            roomHistory.push(...added); roomCursor = page.nextCursor;
            renderRooms(added, true);
        }
    } catch (error) {
        if (requestId === statisticsRequest) { statsActionNotice.textContent = (error as Error).message; statsActionNotice.hidden = false; }
    } finally { if (requestId === statisticsRequest) { historyLoading[kind] = false; updateHistoryButtons(); } }
}
moreVideosButton.addEventListener('click', () => { void loadMoreHistory('videos'); });
moreRoomsButton.addEventListener('click', () => { void loadMoreHistory('rooms'); });

async function loadStatistics(videosOnly = false, retainDepth = false) {
    const requestId = ++statisticsRequest;
    const creator = videoPlayerFilter.value;
    screenStats.setAttribute('aria-busy', 'true');
    historyLoading.videos = false; historyLoading.rooms = false; updateHistoryButtons();

    try {
        const response = await fetch(`/api/stats${creator ? `?player=${encodeURIComponent(creator)}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error('Statistik-Request fehlgeschlagen');

        const data = await response.json() as {
            databaseEnabled: boolean;
            overview: StatsOverview;
            players: PlayerStats[];
            recentVideos: VideoStats[];
            videoCreators?: VideoCreator[];
            rooms?: RoomStats[];
            videoCursor?: string | null;
            roomCursor?: string | null;
            videoStorageMode: string;
            archive?: { usedBytes: number; maxBytes: number; videoCount: number };
        };

        if (requestId !== statisticsRequest || screenStats.style.display === 'none') return;
        if (!data.databaseEnabled) {
            statsNotice.innerText = 'Statistiken sind momentan nicht verfügbar.';
            return;
        }

        const videos = await retainHistory('videos', data.recentVideos, data.videoCursor || null, retainDepth ? videoHistory.length : 0, creator, requestId);
        const rooms = videosOnly ? null : await retainHistory('rooms', data.rooms || [], data.roomCursor || null, retainDepth ? roomHistory.length : 0, creator, requestId);
        if (requestId !== statisticsRequest || screenStats.style.display === 'none') return;
        videoHistory = videos.items; videoCursor = videos.nextCursor;
        if (rooms) { roomHistory = rooms.items; roomCursor = rooms.nextCursor; }
        videoStorageMode = data.videoStorageMode;

        // Keep focused controls and the content above the filter in place.
        if (!videosOnly) { renderStatsOverview(data.overview); renderStats(data.players, data.videoCreators); renderRooms(roomHistory); }
        if (videoPlayerFilter.value !== creator) { void loadStatistics(true); return; }
        const position = videoPlayerFilter.getBoundingClientRect().top;
        if (videosOnly) screenStats.style.minHeight = `${screenStats.offsetHeight}px`;
        renderVideoStats(videoHistory, videoStorageMode);
        if (videosOnly) window.scrollBy(0, videoPlayerFilter.getBoundingClientRect().top - position);
        document.getElementById('archiveUsage')!.innerText = data.archive ? `${data.archive.videoCount} archivierte Videos · ${(data.archive.usedBytes / 1024 / 1024).toFixed(1)} / ${Math.round(data.archive.maxBytes / 1024 / 1024)} MB` : '';
    } catch {
        if (requestId === statisticsRequest) { statsActionNotice.textContent = 'Statistiken konnten nicht geladen werden.'; statsActionNotice.hidden = false; }
    } finally { if (requestId === statisticsRequest) { screenStats.removeAttribute('aria-busy'); updateHistoryButtons(); } }
}
statsButton.addEventListener('click', () => {
    videoPlayerFilter.value = ''; resetEditing(); screenStats.style.minHeight = ''; statsActionNotice.hidden = true;
    showScreen(screenStats); void loadStatistics(); void accounts.load();
});
videoPlayerFilter.addEventListener('change', () => { void loadStatistics(true); });

async function removeStatistic(url: string) {
    const response = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return;
    const data = await response.json() as { error?: string; undoUntil?: number };
    if (!response.ok) throw new Error(data.error || 'Der Eintrag konnte nicht gelöscht werden.');
    return data;
}

async function deleteSelectedStatistics(urls: string[], kind: HistoryKind) {
    const failed: string[] = [], reasons = new Set<string>();
    statsActionNotice.hidden = true;
    for (const url of urls) {
        try {
            const result = await removeStatistic(url);
            if (kind === 'videos' && result?.undoUntil) undoVideos.remember([{ url, undoUntil: result.undoUntil }]);
        }
        catch (error) { failed.push(url); reasons.add(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.'); }
    }
    await loadStatistics(false, true);
    if (failed.length) {
        const items = kind === 'rooms' ? 'Räume' : 'Videos';
        const item = kind === 'rooms' ? 'Raum' : 'Video';
        const total = urls.length === 1 ? item : kind === 'rooms' ? 'Räumen' : 'Videos';
        const remaining = failed.length === 1 ? `Der übrige ${item} bleibt ausgewählt.` : `Die übrigen ${items} bleiben ausgewählt.`;
        statsActionNotice.textContent = `${urls.length - failed.length} von ${urls.length} ${total} gelöscht. ${[...reasons].join(' ')} ${remaining}`;
        statsActionNotice.hidden = false;
    }
    return failed;
}

backToLobbyButton.addEventListener('click', () => {
    ++statisticsRequest;
    resetEditing();
    showScreen(screenLobby);
});

copyRoomCodeButton.addEventListener('click', async () => {
    const roomCode = currentRoomId || displayRoomCode.innerText;
    if (!roomCode || roomCode === '----') return;

    try {
        const invitation = new URL('/', location.origin); invitation.searchParams.set('room', roomCode);
        await navigator.clipboard.writeText(invitation.href);
        showRoomNotice(`Einladungslink für Raum ${roomCode} kopiert.`);
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
        const invited = invitationCode();
        if (invited && invited !== stored?.roomId) { localStorage.removeItem('slopurself-session'); return; }
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

function invitationCode() {
    const code = new URL(location.href).searchParams.get('room')?.toUpperCase() || '';
    return /^[A-Z0-9]{4}$/.test(code) ? code : '';
}
function clearInvitation() {
    const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
    document.getElementById('invitationNotice')!.hidden = true;
}

// --- SCREEN 2: ERSTELLEN vs. WARTEN ---
socket.on('showCreateScreen', (data: { activeCreatorId: string; activeCreatorName: string; hostId: string }) => {
    showCreateState(data);
});

customButton.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); imageInput.click(); }
});

finishPreviewButton.addEventListener('click', () => {
    variants.preview();
});
votingVideoPlayer.addEventListener('timeupdate', () => variants.previewPlayed(votingVideoPlayer));

imageInput.addEventListener('change', async (event: Event) => {
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

        const phase = currentPhaseKey;
        try {
            const prepared = await prepareImage(file);
            if (imageInput.files?.[0] !== file || currentPhaseKey !== phase) return;
            imagePreview.src = prepared; imagePreview.style.display = 'block';
            customButton.innerText = 'Anderes Bild auswählen';
        } catch (error) { clearImagePreview(); alert((error as Error).message); }
    } else {
        clearImagePreview();
    }
});

uploadButton.addEventListener('click', async () => {
    const file = imageInput.files?.[0];
    const promptText = promptInput.value.trim();

    if (!file && !variants.shared()) return alert('Bitte wähle zuerst ein Bild aus!');
    if (!variants.shared() && file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)) {
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

    try {
        const imageBase64 = variants.shared() ? undefined : await prepareImage(file!);
        if (currentRoomId !== uploadRoomId || currentPhaseKey !== uploadTurnKey) return;
        socket.emit('sendImage', {
            roomId: uploadRoomId,
            imageBase64,
            prompt: promptText
        });
    } catch (error) {
        alert((error as Error).message || 'Das Bild konnte nicht gelesen werden.');
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
    }
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
        variants.vote(points);

        voteButtons.forEach(button => button.disabled = true);
        votingActionBox.style.display = 'none';
        votingWaitingBox.style.display = 'block';
        votingStatusText.innerText = `Du hast ${points} Sterne gegeben! Warte auf die anderen...`;
    });
});

// SCREEN 4: ERGEBNISSE & HIGHSCORE
function showResultsState(data: { authorName: string; roundPoints: number; abstentions?: number; players: { id: string; name: string; score: number }[]; currentRound: number; maxRounds: number; nextRound?: number; isFinalRound: boolean }) {
    showScreen(screenResult);
    const isHost = isCurrentSocket(currentHostId);

    resultAuthorName.innerText = `Video von ${data.authorName}`;
    resultPointsSummary.innerText = `+${data.roundPoints} Punkte für dieses Video${data.abstentions ? ` · ${data.abstentions} ${data.abstentions === 1 ? 'Enthaltung' : 'Enthaltungen'}` : ''}`;
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
    const rematch = document.getElementById('rematchGameButton') as HTMLButtonElement;
    rematch.hidden = !isHost; rematch.disabled = disconnected;
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
    signedIn: async (name, hfRequired) => {
        hfConnection.lock(false);
        await hfConnection.signedIn(hfRequired);
        if (name) usernameInput.value = name.slice(0, 15);
        usernameInput.type = name ? 'hidden' : 'text';
        showScreen(screenLobby);
        const invited = invitationCode();
        if (invited) {
            roomCodeInput.value = invited;
            const notice = document.getElementById('invitationNotice')!; notice.textContent = `Einladung zu Raum ${invited}`; notice.hidden = false;
        }
        if (socket.isNativeWebSocket) await resumeStoredSession(); else await socket.connectToRoom('');
    },
    signedOut: async () => {
        await hfConnection.signedOut();
        if (currentRoomId) { socket.emit('leaveRoom', { roomId: currentRoomId }); await new Promise(resolve => setTimeout(resolve, 200)); }
        clearSession(); gameHeader.style.display = 'none';
    },
    showAuth: () => showScreen(document.getElementById('screenAuth')!),
    refreshToken: token => { if (socket.id) socket.emit('refreshAuth', { token }); }
});
