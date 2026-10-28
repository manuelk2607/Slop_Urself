import type { QuotaCapacity } from '../ai/quota';
import { gameOptions } from './options';
import type { Room } from './rules';

export interface ArchiveClip { id: string; creatorId: string; creatorName: string; prompt: string; videoUrl: string }
export const isArchiveGame = (room: Room) => gameOptions(room.options).mode !== 'classic';
export function archiveCapacity(clips: ArchiveClip[], players: number): QuotaCapacity {
    return { aiRoundLimit: Math.floor(clips.length / players), availableGenerations: clips.length, playerCount: players, quotaMode: 'archive' };
}
export function prepareArchive(room: Room, clips: ArchiveClip[]) {
    const count = room.maxRounds * room.players.length;
    if (count < 1 || clips.length < count) throw new Error('Nicht genügend gespeicherte Videos für eine vollständige Runde.');
    const shuffled = [...clips];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    room.archiveClips = shuffled.slice(0, count); room.archiveResults = [];
}
export function playArchiveVideo(room: Room) {
    if (!isArchiveGame(room) || room.state !== 'IDLE') return;
    const clip = room.archiveClips?.shift();
    if (!clip) { room.state = 'GAME_OVER'; return; }
    room.archiveCurrent = clip;
    room.currentPrompt = clip.prompt; room.currentVideoUrl = clip.videoUrl; room.state = 'VOTING';
}

export const needsContentCheck = (room: Room) => ['VOTING', 'GUESS_REVIEW'].includes(room.state)
    && Boolean(room.currentVideoUrl) && (isArchiveGame(room) || room.currentVideoUrl.startsWith('/api/videos/'));
// Recheck immediately before tallying and periodically while a clip is open.
// A media ban already denies GET/HEAD/Range; this also keeps the game moving.
export async function checkArchiveContent(room: Room, blocked: (url: string) => Promise<boolean>): Promise<'allowed' | 'skipped' | 'stale'> {
    if (!needsContentCheck(room)) return 'allowed';
    const url = room.currentVideoUrl, ballot = room.ballotId;
    const denied = await blocked(url);
    // Node can receive a leave/next-turn event during the storage read.
    if (room.currentVideoUrl !== url || room.ballotId !== ballot || !['VOTING', 'GUESS_REVIEW'].includes(room.state)) return 'stale';
    if (!denied) return 'allowed';
    const curator = room.players[room.activeCreatorIndex];
    room.pendingCreators = room.pendingCreators?.filter(id => id !== curator?.id);
    room.archiveClips = room.archiveClips?.filter(clip => clip.videoUrl !== url);
    room.archiveCurrent = undefined;
    room.currentVideoUrl = ''; room.currentPrompt = ''; room.currentVotes = {};
    room.guesses = {}; room.guessesReviewed = false; room.voteDetails = {};
    room.previewDeadline = undefined; room.previewConfirmed = undefined;
    room.ballotId = crypto.randomUUID();
    room.lastResult = { authorName: 'Gesperrtes Video übersprungen', roundPoints: 0 };
    room.state = room.currentRound >= room.maxRounds && !room.pendingCreators?.length ? 'GAME_OVER' : 'RESULTS';
    return 'skipped';
}
