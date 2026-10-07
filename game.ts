import type { QuotaCapacity } from './quota';
import type { AiJob } from './ai';

export type GameState = 'LOBBY' | 'IDLE' | 'GENERATING' | 'VOTING' | 'RESULTS' | 'GAME_OVER';
export const DISCONNECT_GRACE_MS = 15_000;
export const SOLO_PREVIEW_MS = 10_000;

export interface Player {
    id: string;
    accountId?: string;
    sessionId: string;
    connectionId?: string;
    name: string;
    score: number;
    connected: boolean;
    disconnectedAt?: number;
}

export interface Room {
    code: string;
    hostId: string;
    players: Player[];
    state: GameState;
    activeCreatorIndex: number;
    currentVotes: Record<string, number>;
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
    generationJob?: AiJob;
    generationRetryAt?: number;
    soloFinishAt?: number;
    lastResult?: { authorName: string; roundPoints: number };
}

export function activeCreator(room: Room) {
    return room.players[room.activeCreatorIndex];
}

export function startRounds(room: Room) {
    room.roundPlayers = room.players.map(p => p.id);
    room.pendingCreators = [...room.roundPlayers];
    room.currentRound = 1;
    room.videoNumber = 1;
    room.activeCreatorIndex = 0;
    room.state = 'IDLE';
}

export function extendRound(room: Room) {
    if (room.state !== 'GAME_OVER' || !room.players.length || room.players.some(p => !p.connected)) throw new Error('Die Partie kann gerade nicht verlaengert werden.');
    if (!Number.isSafeInteger(room.maxRounds + 1)) throw new Error('Ungueltige Rundenzahl.');
    const videoNumber = room.videoNumber || room.currentRound;
    room.currentRound = ++room.maxRounds;
    room.videoNumber = videoNumber + 1;
    room.roundPlayers = room.players.map(p => p.id);
    room.pendingCreators = [...room.roundPlayers];
    room.activeCreatorIndex = 0;
    room.currentVotes = {};
    room.currentPrompt = '';
    room.currentVideoUrl = '';
    room.lastResult = undefined;
    room.generationId = undefined;
    room.generationJob = undefined;
    room.generationRetryAt = undefined;
    room.soloFinishAt = undefined;
    room.extensionQuota = undefined;
    room.state = 'IDLE';
}

export function nextRoundNumber(room: Room) {
    return room.pendingCreators?.length ? room.currentRound : room.currentRound + 1;
}

export function remainingVideos(room: Room) {
    return room.pendingCreators
        ? room.pendingCreators.length + Math.max(0, room.maxRounds - room.currentRound) * room.roundPlayers!.length
        : Math.max(0, room.maxRounds - room.currentRound + 1);
}

function selectNextCreator(room: Room) {
    if (room.pendingCreators && !room.pendingCreators.length && room.currentRound < room.maxRounds) {
        room.currentRound++;
        room.pendingCreators = [...room.roundPlayers!];
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
    room.currentPrompt = '';
    room.currentVideoUrl = '';
    room.lastResult = undefined;
    room.generationJob = undefined;
    room.generationRetryAt = undefined;
}

export function playerForConnection(room: Room, connectionId: string) {
    return room.players.find(p => p.connected && (p.connectionId || p.id) === connectionId);
}

export function publicPlayers(room: Room) {
    return room.players.map(({ id, name, score, connected }) => ({ id, name, score, connected }));
}

export function roomSnapshot(room: Room) {
    const creator = activeCreator(room);
    return {
        roomId: room.code, playerCount: room.players.filter(p => p.connected).length,
        players: publicPlayers(room), hostId: room.hostId, gameState: room.state,
        currentRound: room.currentRound, maxRounds: room.maxRounds,
        videoNumber: room.videoNumber || room.currentRound,
        turnNumber: room.roundPlayers ? Math.max(1, room.roundPlayers.indexOf(creator?.id || '') + 1) : undefined,
        turnCount: room.roundPlayers?.length,
        nextRound: nextRoundNumber(room), quota: room.quota, extensionQuota: room.extensionQuota,
        activeCreatorId: creator?.id, activeCreatorName: creator?.name,
        currentVideoUrl: room.currentVideoUrl, lastResult: room.lastResult,
        votedPlayerIds: Object.keys(room.currentVotes)
    };
}

export function finalStandings(room: Room) {
    const sorted = [...room.players].sort((a, b) => b.score - a.score);
    return sorted.map(player => ({
        playerSocketId: player.id, name: player.name, score: player.score,
        finalRank: sorted.findIndex(p => p.score === player.score) + 1
    }));
}

export function removePlayer(room: Room, playerId: string) {
    const index = room.players.findIndex(p => p.id === playerId);
    if (index < 0) return 0;
    const wasActive = room.activeCreatorIndex === index;
    // Never release an in-flight job or a video that has already consumed its quota.
    const skippedGenerations = room.pendingCreators
        ? Math.max(0, room.maxRounds - room.currentRound + Number(room.pendingCreators.includes(playerId)) - Number(wasActive && ['GENERATING', 'VOTING'].includes(room.state)))
        : 0;
    if (room.roundPlayers) room.roundPlayers = room.roundPlayers.filter(id => id !== playerId);
    if (room.pendingCreators) room.pendingCreators = room.pendingCreators.filter(id => id !== playerId);
    room.players.splice(index, 1);
    delete room.currentVotes[playerId];
    if (!room.players.length) return skippedGenerations;
    if (index < room.activeCreatorIndex) room.activeCreatorIndex--;
    room.activeCreatorIndex %= room.players.length;
    // RESULTS advances once more when the host starts the next round.
    if (wasActive && room.state === 'RESULTS' && !room.pendingCreators) {
        room.activeCreatorIndex = (room.activeCreatorIndex + room.players.length - 1) % room.players.length;
    }
    if (room.hostId === playerId) room.hostId = (room.players.find(p => p.connected) || room.players[0]).id;
    if (wasActive && ['IDLE', 'GENERATING', 'VOTING'].includes(room.state)) {
        room.state = 'IDLE';
        room.currentVotes = {};
        room.currentPrompt = '';
        room.currentVideoUrl = '';
        room.lastResult = undefined;
        room.generationId = undefined;
        room.generationJob = undefined;
        room.generationRetryAt = undefined;
        room.soloFinishAt = undefined;
        if (room.pendingCreators) selectNextCreator(room);
    }
    return skippedGenerations;
}

// Complete synchronously before any persistence await, so a second vote cannot score twice.
export function finishVoting(room: Room, now = Date.now()) {
    if (room.state !== 'VOTING') return false;
    const creator = activeCreator(room);
    if (!creator) return false;
    const voters = room.players.filter(p => p.id !== creator.id);
    if (voters.some(p => room.currentVotes[p.id] === undefined)) return false;
    if (!voters.length && room.soloFinishAt && now < room.soloFinishAt) return false;
    const points = Object.values(room.currentVotes).reduce((sum, value) => sum + value, 0);
    creator.score += points;
    room.lastResult = { authorName: creator.name, roundPoints: points };
    if (room.pendingCreators) room.pendingCreators = room.pendingCreators.filter(id => id !== creator.id);
    room.state = room.currentRound >= room.maxRounds && !room.pendingCreators?.length ? 'GAME_OVER' : 'RESULTS';
    if (room.state === 'GAME_OVER') room.extensionQuota = undefined;
    room.soloFinishAt = undefined;
    return true;
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
