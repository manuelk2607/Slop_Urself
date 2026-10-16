import { activeCreator, finalStandings, guessList, type Room } from './rules';
import type { PersistRoundInput } from '../database/types';

export function roundInput(room: Room): PersistRoundInput {
    return {
        roomCode: room.code, roundNumber: room.videoNumber || room.currentRound,
        creatorSocketId: activeCreator(room)!.id, prompt: room.currentPrompt,
        videoUrl: room.currentVideoUrl, roundPoints: room.lastResult!.roundPoints,
        votes: Object.entries(room.currentVotes).filter(([, points]) => points > 0).map(([voterSocketId, points]) => ({ voterSocketId, points, ...room.voteDetails?.[voterSocketId] })),
        taskText: room.tasks?.[activeCreator(room)!.id], guesses: guessList(room),
        players: room.players, hostId: room.hostId,
        standings: room.state === 'GAME_OVER' ? finalStandings(room) : undefined
    };
}
