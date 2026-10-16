import { gameOptions } from './options';
import { activeCreator, advanceTurn, finishVoting, type Room } from './rules';
import { playArchiveVideo } from './archive-play';

export function syncPhase(room: Room, now = Date.now()) {
    const key = `${room.videoNumber || 0}:${room.currentRound}:${activeCreator(room)?.id}:${room.state}`;
    if (room.phaseKey === key) return;
    room.phaseKey = key;
    const seconds = gameOptions(room.options).phaseSeconds;
    room.phaseDeadline = seconds && ['IDLE', 'VOTING', 'GUESS_REVIEW'].includes(room.state) ? now + seconds * 1000 : undefined;
}

// Generation is never skipped: an uncertain upstream job must retain its reservation.
export function closePhase(room: Room): 'skipped' | 'voted' | 'advanced' | undefined {
    if (room.state === 'RESULTS') { advanceTurn(room); playArchiveVideo(room); return 'advanced'; }
    if (room.state === 'IDLE') {
        const creator = activeCreator(room);
        room.pendingCreators = room.pendingCreators?.filter(id => id !== creator?.id);
        room.lastResult = { authorName: creator?.name || 'Spieler', roundPoints: 0 };
        room.state = room.currentRound >= room.maxRounds && !room.pendingCreators?.length ? 'GAME_OVER' : 'RESULTS';
        return 'skipped';
    }
    if (room.state === 'GUESS_REVIEW') { room.guessesReviewed = true; room.state = 'VOTING'; }
    if (room.state === 'VOTING' && finishVoting(room, true, true)) return 'voted';
}
