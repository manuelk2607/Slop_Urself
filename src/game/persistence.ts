import { activeCreator, finalStandings, type Room } from './rules';
import type { PersistRoundInput } from '../database/types';

export function roundInput(room: Room): PersistRoundInput {
    return {
        roomCode: room.code, roundNumber: room.videoNumber || room.currentRound,
        creatorSocketId: activeCreator(room)!.id, prompt: room.currentPrompt,
        videoUrl: room.currentVideoUrl, roundPoints: room.lastResult!.roundPoints,
        votes: Object.entries(room.currentVotes).map(([voterSocketId, points]) => ({ voterSocketId, points })),
        players: room.players, hostId: room.hostId,
        standings: room.state === 'GAME_OVER' ? finalStandings(room) : undefined
    };
}
