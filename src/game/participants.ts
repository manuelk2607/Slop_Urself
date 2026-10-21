import type { Player, Room } from './rules';
import { gameOptions } from './options';

export const MAX_PLAYERS = 10, MAX_SPECTATORS = 20;
export const participants = (room: Room) => [...room.players, ...(room.spectators || [])];
export const isSpectator = (room: Room, player: Player) => !room.players.some(p => p.id === player.id);
export const participantForConnection = (room: Room, id: string) => participants(room).find(p => p.connected && (p.connectionId || p.id) === id);
export function resetReady(room: Room) { for (const player of room.players) player.ready = false; }
export function startProblem(room: Room) {
    if (!room.players.length || room.players.some(p => !p.connected)) return 'Warte, bis alle Spieler verbunden sind.';
    if (gameOptions(room.options).requireReady && room.players.some(p => !p.ready)) return 'Warte, bis alle Spieler bereit sind.';
    return undefined;
}
export function checkJoin(room: Room, name: string, accountId: string | undefined, spectator: boolean) {
    if (!spectator && room.state !== 'LOBBY') throw new Error('Dieses Spiel wurde bereits gestartet. Du kannst noch zuschauen.');
    if ((spectator ? room.spectators || [] : room.players).length >= (spectator ? MAX_SPECTATORS : MAX_PLAYERS)) throw new Error(spectator ? 'Alle 20 Zuschauerplätze sind belegt.' : 'Alle 10 Spielerplätze sind belegt.');
    if (participants(room).some(p => p.name.toLowerCase() === name.toLowerCase() || (accountId && p.accountId === accountId))) throw new Error('Dieser Benutzer ist bereits im Raum.');
}

export interface RoomTransfer { roomId: string; playerId: string; sessionId: string }
export function prepareRematch(room: Room, code: string) {
    if (room.state !== 'GAME_OVER' || startProblem({ ...room, options: gameOptions({ ...room.options, requireReady: false }) })) throw new Error('Für die Revanche müssen alle Spieler verbunden sein.');
    const transfers: Record<string, RoomTransfer> = {};
    const copy = (player: Player): Player => {
        const id = crypto.randomUUID(), sessionId = crypto.randomUUID();
        transfers[player.id] = { roomId: code, playerId: id, sessionId };
        return { id, sessionId, accountId: player.accountId, hfConnectionId: player.hfConnectionId, name: player.name, score: 0, ready: false, connected: false, disconnectedAt: Date.now() + 45_000 };
    };
    const players = room.players.map(copy), spectators = (room.spectators || []).filter(p => p.connected).map(copy);
    const next: Room = { code, hostId: transfers[room.hostId].playerId, players, spectators, state: 'LOBBY', activeCreatorIndex: 0, currentVotes: {}, currentRound: 1,
        maxRounds: room.maxRounds, currentPrompt: '', currentVideoUrl: '', options: gameOptions(room.options), imageProfile: 'bounded' };
    return { requestId: crypto.randomUUID(), room: next, transfers, initialized: false };
}
