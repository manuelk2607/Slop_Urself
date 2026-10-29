import type { QuotaCapacity } from '../ai/quota';
import type { AiJob } from '../ai/generation';
import { gameOptions, assignTasks, type GameOptions } from './options';
import type { SharedImage } from './images';
import { isArchiveGame, type ArchiveClip } from './archive-play';
import { resetReady, startProblem } from './participants';
import type { GenerationStage, GenerationView } from '../shared/generation';

export type GameState = 'LOBBY' | 'IDLE' | 'GENERATING' | 'VOTING' | 'GUESS_REVIEW' | 'RESULTS' | 'GAME_OVER';
// Mobile backgrounding and HF approval commonly outlast a short network retry.
// Explicit leaving still removes immediately; disconnected players cannot vote.
export const DISCONNECT_GRACE_MS = 90_000;

export interface Player {
    id: string;
    accountId?: string;
    hfConnectionId?: string;
    sessionId: string;
    connectionId?: string;
    name: string;
    score: number;
    guessPoints?: number;
    connected: boolean;
    ready?: boolean;
    disconnectedAt?: number;
}

export interface Room {
    code: string;
    hostId: string;
    players: Player[];
    spectators?: Player[];
    rematch?: ReturnType<typeof import('./participants').prepareRematch>;
    rematchSource?: string;
    state: GameState;
    activeCreatorIndex: number;
    currentVotes: Record<string, number>;
    ballotId?: string;
    currentRound: number;
    maxRounds: number;
    roundPlayers?: string[];
    pendingCreators?: string[];
    videoNumber?: number;
    quota?: QuotaCapacity;
    extensionQuota?: QuotaCapacity;
    currentPrompt: string;
    currentVideoUrl: string;
    generationId?: string;
    generationStartedAt?: number;
    generationStage?: GenerationStage;
    generationJob?: AiJob;
    generationRetryAt?: number;
    lastResult?: { authorName: string; roundPoints: number; abstentions?: number };
    previewDeadline?: number;
    previewConfirmed?: boolean;
    options?: GameOptions;
    imageProfile?: 'bounded';
    sharedImage?: SharedImage;
    sharedImagePending?: boolean;
    tasks?: Record<string, string>;
    guesses?: Record<string, { text: string; correct?: boolean }>;
    guessesReviewed?: boolean;
    voteDetails?: Record<string, { taskPoints: number; funPoints: number }>;
    phaseKey?: string;
    phaseDeadline?: number;
    archiveClips?: ArchiveClip[];
    archiveCurrent?: ArchiveClip;
    archiveResults?: { id: string; creatorName: string; points: number; votes: number; prompt: string }[];
}

export function activeCreator(room: Room) {
    return room.players[room.activeCreatorIndex];
}
export const roomAccountIds = (room: Room) => [...new Set(room.players.map(p => p.accountId).filter((id): id is string => Boolean(id)))];

export function startRounds(room: Room) {
    room.ballotId = crypto.randomUUID();
    room.roundPlayers = room.players.map(p => p.id);
    room.pendingCreators = [...room.roundPlayers];
    room.currentRound = 1;
    room.videoNumber = 1;
    room.activeCreatorIndex = 0;
    room.state = 'IDLE';
    room.tasks = gameOptions(room.options).secretTasks ? assignTasks(room.roundPlayers) : {};
    room.guesses = {}; room.guessesReviewed = false; room.voteDetails = {};
}

export function extendRound(room: Room) {
    if (room.state !== 'GAME_OVER' || !room.players.length || room.players.some(p => !p.connected)) throw new Error('Die Partie kann gerade nicht verlängert werden.');
    if (!Number.isSafeInteger(room.maxRounds + 1)) throw new Error('Ungültige Rundenzahl.');
    const videoNumber = room.videoNumber || room.currentRound;
    room.currentRound = ++room.maxRounds;
    room.videoNumber = videoNumber + 1;
    room.roundPlayers = room.players.map(p => p.id);
    room.pendingCreators = [...room.roundPlayers];
    room.activeCreatorIndex = 0;
    room.currentVotes = {};
    room.ballotId = crypto.randomUUID();
    room.currentPrompt = '';
    room.currentVideoUrl = '';
    room.lastResult = undefined;
    room.generationId = undefined;
    room.generationJob = undefined;
    room.generationRetryAt = undefined;
    room.extensionQuota = undefined;
    room.state = 'IDLE';
    room.tasks = gameOptions(room.options).secretTasks ? assignTasks(room.roundPlayers) : {};
    room.guesses = {}; room.guessesReviewed = false; room.voteDetails = {};
}

export function nextRoundNumber(room: Room) {
    return room.pendingCreators?.length ? room.currentRound : room.currentRound + 1;
}

export function remainingVideos(room: Room) {
    return room.pendingCreators
        ? room.pendingCreators.length + Math.max(0, room.maxRounds - room.currentRound) * room.roundPlayers!.length
        : Math.max(0, room.maxRounds - room.currentRound + 1);
}

export function remainingVideosFor(room: Room, playerId: string) {
    return room.pendingCreators ? Math.max(0, room.maxRounds - room.currentRound) + Number(room.pendingCreators.includes(playerId)) : remainingVideos(room);
}

function selectNextCreator(room: Room) {
    if (room.pendingCreators && !room.pendingCreators.length && room.currentRound < room.maxRounds) {
        room.currentRound++;
        room.pendingCreators = [...room.roundPlayers!];
        room.tasks = gameOptions(room.options).secretTasks ? assignTasks(room.roundPlayers!) : {};
    }
    if (!room.pendingCreators?.length) { room.state = 'GAME_OVER'; return; }
    room.activeCreatorIndex = room.players.findIndex(p => p.id === room.pendingCreators![0]);
    room.state = 'IDLE';
}

export function advanceTurn(room: Room) {
    if (room.state !== 'RESULTS') return;
    if (room.pendingCreators) selectNextCreator(room);
    else { room.activeCreatorIndex = (room.activeCreatorIndex + 1) % room.players.length; room.currentRound++; room.state = 'IDLE'; }
    room.videoNumber = (room.videoNumber || room.currentRound - 1) + 1;
    room.currentVotes = {};
    room.ballotId = crypto.randomUUID();
    room.currentPrompt = '';
    room.currentVideoUrl = '';
    room.lastResult = undefined;
    room.generationJob = undefined;
    room.generationRetryAt = undefined;
    room.guesses = {}; room.guessesReviewed = false; room.voteDetails = {};
}

export function playerForConnection(room: Room, connectionId: string) {
    return room.players.find(p => p.connected && (p.connectionId || p.id) === connectionId);
}

export function publicPlayers(room: Room) {
    return room.players.map(({ id, name, score, connected, ready }) => ({ id, name, score, connected, ready: ready === true }));
}

export function roomSnapshot(room: Room, viewerId?: string) {
    const creator = activeCreator(room);
    room.ballotId ||= crypto.randomUUID();
    return {
        roomId: room.code, playerCount: room.players.filter(p => p.connected).length,
        spectators: (room.spectators || []).map(({ id, name, connected }) => ({ id, name, connected })),
        spectatorCount: (room.spectators || []).filter(p => p.connected).length,
        role: room.players.some(p => p.id === viewerId) ? 'player' : 'spectator',
        startProblem: startProblem(room),
        players: publicPlayers(room), hostId: room.hostId, gameState: room.state,
        currentRound: room.currentRound, maxRounds: room.maxRounds,
        videoNumber: room.videoNumber || room.currentRound,
        ballotId: room.ballotId,
        turnNumber: room.roundPlayers ? Math.max(1, room.roundPlayers.indexOf(creator?.id || '') + 1) : undefined,
        turnCount: room.roundPlayers?.length,
        nextRound: nextRoundNumber(room), quota: room.quota, extensionQuota: room.extensionQuota,
        activeCreatorId: creator?.id, activeCreatorName: creator?.name,
        generation: generationView(room),
        currentVideoUrl: room.currentVideoUrl, lastResult: room.lastResult, phaseKey: room.phaseKey, phaseDeadline: room.phaseDeadline, serverTime: Date.now(),
        archiveAuthor: isArchiveGame(room) ? room.archiveCurrent?.creatorName : undefined,
        archiveResults: room.archiveResults,
        votedPlayerIds: Object.keys(room.currentVotes),
        voting: ballotProgress(room),
        hasAbstained: viewerId ? room.currentVotes[viewerId] === 0 : false,
        previewDeadline: room.previewDeadline, previewConfirmed: room.previewConfirmed,
        options: gameOptions(room.options),
        sharedImageUrl: room.sharedImage ? `/api/rooms/${room.code}/image?id=${room.sharedImage.id}` : undefined,
        sharedImagePending: Boolean(room.sharedImagePending),
        ownTask: viewerId === creator?.id ? room.tasks?.[viewerId] : undefined,
        ownGuess: viewerId ? room.guesses?.[viewerId]?.text : undefined,
        task: room.players.some(p => p.id === viewerId) ? revealedTask(room) : undefined,
        reviewPrompt: room.state === 'GUESS_REVIEW' && viewerId === creator?.id ? room.currentPrompt : undefined,
        reviewGuesses: room.state === 'GUESS_REVIEW' && viewerId === creator?.id ? guessList(room) : undefined,
        reveal: ['RESULTS', 'GAME_OVER'].includes(room.state) ? { prompt: room.currentPrompt, task: room.tasks?.[creator?.id || ''], guesses: guessList(room) } : undefined
    };
}

export function generationView(room: Room): GenerationView | undefined {
    const startedAt = room.generationStartedAt || room.generationJob?.submittedAt;
    if (room.state !== 'GENERATING' || !room.generationId || !Number.isSafeInteger(startedAt) || !startedAt || startedAt < 0) return undefined;
    return { id: room.generationId, startedAt, stage: room.generationJob?.status === 'complete' ? 'archive' : room.generationStage || 'result' };
}

export function ballotProgress(room: Room) {
    const includesCreator = gameOptions(room.options).mode === 'archive-vote';
    const creator = activeCreator(room)?.id;
    const submitted = Object.keys(room.currentVotes).filter(id => includesCreator || id !== creator);
    // Departed voters retain their accepted vote and place in the denominator;
    // only a departed uncast vote ceases to be due. Spectators never enter it.
    const eligible = new Set([...room.players.filter(player => includesCreator || player.id !== creator).map(player => player.id), ...submitted]);
    return { voted: submitted.length, total: eligible.size };
}

export function finalStandings(room: Room) {
    const sorted = [...room.players].sort((a, b) => b.score - a.score);
    return sorted.map(player => ({
        playerSocketId: player.id, name: player.name, score: player.score, guessPoints: player.guessPoints || 0,
        finalRank: sorted.findIndex(p => p.score === player.score) + 1
    }));
}

export function removePlayer(room: Room, playerId: string) {
    const index = room.players.findIndex(p => p.id === playerId);
    if (index < 0) return 0;
    const wasActive = room.activeCreatorIndex === index;
    // Never release an in-flight job or a video that has already consumed its quota.
    const skippedGenerations = room.pendingCreators
        ? Math.max(0, room.maxRounds - room.currentRound + Number(room.pendingCreators.includes(playerId)) - Number(wasActive && ['GENERATING', 'VOTING', 'GUESS_REVIEW'].includes(room.state)))
        : 0;
    if (room.roundPlayers) room.roundPlayers = room.roundPlayers.filter(id => id !== playerId);
    if (room.pendingCreators) room.pendingCreators = room.pendingCreators.filter(id => id !== playerId);
    room.players.splice(index, 1);
    resetReady(room);
    // Accepted ballots remain immutable when their voter leaves. Only uncast
    // votes cease to be due; retained details still belong in persistence.
    if (!room.players.length) return skippedGenerations;
    if (index < room.activeCreatorIndex) room.activeCreatorIndex--;
    room.activeCreatorIndex %= room.players.length;
    // RESULTS advances once more when the host starts the next round.
    if (wasActive && room.state === 'RESULTS' && !room.pendingCreators) {
        room.activeCreatorIndex = (room.activeCreatorIndex + room.players.length - 1) % room.players.length;
    }
    if (room.hostId === playerId) room.hostId = (room.players.find(p => p.connected) || room.players[0]).id;
    if (wasActive && ['IDLE', 'GENERATING', 'VOTING', 'GUESS_REVIEW'].includes(room.state)) {
        room.ballotId = crypto.randomUUID();
        room.state = 'IDLE';
        room.currentVotes = {};
        room.currentPrompt = '';
        room.currentVideoUrl = '';
        room.lastResult = undefined;
        room.generationId = undefined;
        room.generationJob = undefined;
        room.generationRetryAt = undefined;
        room.guesses = {}; room.guessesReviewed = false; room.voteDetails = {};
        if (room.pendingCreators) selectNextCreator(room);
    }
    return skippedGenerations;
}

// Complete synchronously before any persistence await, so a second vote cannot score twice.
export function beginViewing(room: Room, now = Date.now()) {
    room.previewConfirmed = false;
    room.previewDeadline = !isArchiveGame(room) && room.players.length > 1 ? now + 45_000 : undefined;
}
export function confirmPreview(room: Room, player: Player, payload: Record<string, unknown>) {
    if (room.state !== 'VOTING' || activeCreator(room)?.id !== player.id) return false;
    if (payload.ballotId !== room.ballotId || payload.videoNumber !== (room.videoNumber || room.currentRound) || payload.currentRound !== room.currentRound) throw new Error('Diese Bestätigung gehört zu einem anderen Video.');
    room.previewConfirmed = true;
    return true;
}
export function finishVoting(room: Room, confirmedSolo = false, abstainMissing = false, now = Date.now()) {
    if (room.state === 'GUESS_REVIEW' && !Object.keys(room.guesses || {}).length) { room.guessesReviewed = true; room.state = 'VOTING'; }
    if (room.state !== 'VOTING') return false;
    const creator = activeCreator(room);
    if (!creator) return false;
    const voters = room.players.filter(p => gameOptions(room.options).mode === 'archive-vote' || p.id !== creator.id);
    if (confirmedSolo) room.previewConfirmed = true;
    if (abstainMissing) for (const voter of voters) room.currentVotes[voter.id] ??= 0;
    if (voters.some(p => room.currentVotes[p.id] === undefined)) return false;
    if (!voters.length && !confirmedSolo && !room.previewDeadline) return false;
    if (room.previewDeadline && !room.previewConfirmed && !abstainMissing) {
        if (now < room.previewDeadline) return false;
        room.previewConfirmed = true;
    }
    if (!abstainMissing && gameOptions(room.options).guessPrompt && !room.guessesReviewed && Object.values(room.guesses || {}).some(guess => guess.text)) {
        room.state = 'GUESS_REVIEW'; return false;
    }
    const points = Object.values(room.currentVotes).reduce((sum, value) => sum + value, 0);
    if (!isArchiveGame(room)) creator.score += points;
    else if (room.archiveCurrent) (room.archiveResults ??= []).push({ id: room.archiveCurrent.id, creatorName: room.archiveCurrent.creatorName,
        points, votes: Object.values(room.currentVotes).filter(value => value > 0).length, prompt: room.currentPrompt });
    const abstentions = Object.values(room.currentVotes).filter(value => value === 0).length;
    room.lastResult = { authorName: isArchiveGame(room) ? room.archiveCurrent?.creatorName || creator.name : creator.name, roundPoints: points,
        ...abstentions ? { abstentions } : {} };
    if (room.pendingCreators) room.pendingCreators = room.pendingCreators.filter(id => id !== creator.id);
    room.state = room.currentRound >= room.maxRounds && !room.pendingCreators?.length ? 'GAME_OVER' : 'RESULTS';
    if (room.state === 'GAME_OVER') room.extensionQuota = undefined;
    return true;
}

export function guessList(room: Room) {
    return Object.entries(room.guesses || {}).map(([playerId, guess]) => ({ playerId, name: room.players.find(p => p.id === playerId)?.name || 'Spieler',
        text: guess.text, correct: guess.correct, points: guess.correct ? 2 : 0 }));
}

export function recordVote(room: Room, player: Player, payload: Record<string, unknown>) {
    if (!room.players.some(p => p.id === player.id)) throw new Error('Zuschauer dürfen nicht bewerten.');
    if (!room.ballotId || payload.ballotId !== room.ballotId || payload.videoNumber !== (room.videoNumber || room.currentRound)
        || payload.currentRound !== room.currentRound) throw new Error('Diese Bewertung gehört zu einem anderen Video. Bitte warte auf den aktuellen Spielstand.');
    if (room.state !== 'VOTING' || (gameOptions(room.options).mode !== 'archive-vote' && activeCreator(room)?.id === player.id) || room.currentVotes[player.id] !== undefined) return;
    if (payload.abstain === true) { room.currentVotes[player.id] = 0; return; }
    const options = gameOptions(room.options);
    let points = Number(payload.points);
    let details: { taskPoints: number; funPoints: number } | undefined;
    if (options.secretTasks) {
        const taskPoints = Number(payload.taskPoints), funPoints = Number(payload.funPoints);
        if (![taskPoints, funPoints].every(value => Number.isInteger(value) && value >= 1 && value <= 5)) throw new Error('Bitte bewerte Auftrag und Unterhaltung jeweils mit 1 bis 5 Punkten.');
        points = Math.round((taskPoints + funPoints) / 2);
        details = { taskPoints, funPoints };
    }
    if (!Number.isInteger(points) || points < 1 || points > 5) throw new Error('Bitte vergib 1 bis 5 Punkte.');
    if (options.guessPrompt) {
        if (typeof payload.guess !== 'string' || payload.guess.length > 150) throw new Error('Bitte gib einen Rateversuch mit höchstens 150 Zeichen ab oder überspringe ihn.');
        const text = payload.guess.trim();
        if (text) room.guesses = { ...room.guesses, [player.id]: { text } };
    }
    if (details) room.voteDetails = { ...room.voteDetails, [player.id]: details };
    room.currentVotes[player.id] = points;
}

export function judgeGuesses(room: Room, player: Player, payload: Record<string, unknown>) {
    if (room.state !== 'GUESS_REVIEW' || activeCreator(room)?.id !== player.id || Number(payload.videoNumber) !== (room.videoNumber || room.currentRound)) return false;
    if (!Array.isArray(payload.correctPlayerIds) || payload.correctPlayerIds.some(id => typeof id !== 'string' || !room.guesses?.[id])
        || new Set(payload.correctPlayerIds).size !== payload.correctPlayerIds.length) throw new Error('Ungültige Bewertung der Rateversuche.');
    const correct = new Set(payload.correctPlayerIds);
    for (const [id, guess] of Object.entries(room.guesses || {})) {
        guess.correct = correct.has(id);
        const participant = room.players.find(p => p.id === id);
        if (guess.correct && participant) { participant.score += 2; participant.guessPoints = (participant.guessPoints || 0) + 2; }
    }
    room.guessesReviewed = true; room.state = 'VOTING'; return true;
}

export function revealedTask(room: Room) {
    return ['VOTING', 'GUESS_REVIEW', 'RESULTS', 'GAME_OVER'].includes(room.state) ? room.tasks?.[activeCreator(room)?.id || ''] : undefined;
}

export function sanitizeUsername(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, 15) : '';
}

export function sanitizeRoomId(value: unknown) {
    return typeof value === 'string' && /^[a-z0-9]{4}$/i.test(value.trim()) ? value.trim().toUpperCase() : '';
}

export function sanitizeSessionId(value: unknown) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value) ? value : '';
}

export function roundLimit(value: unknown) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}

export function maxRounds(value: unknown, limit: number) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), limit) : limit;
}
