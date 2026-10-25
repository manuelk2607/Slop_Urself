import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameOptions } from '../../src/game/options';
import { closePhase, syncPhase } from '../../src/game/phases';
import { archiveCapacity, prepareArchive, playArchiveVideo } from '../../src/game/archive-play';
import { startRounds, recordVote as rawRecordVote, finishVoting, judgeGuesses, roomSnapshot, advanceTurn, type Room } from '../../src/game/rules';
import { roundInput } from '../../src/game/persistence';
const recordVote: typeof rawRecordVote = (r, player, payload) => rawRecordVote(r, player, { ...roomSnapshot(r), ...payload });

function room(mode = 'classic'): Room {
    return { code: 'TEST', hostId: 'a', players: ['a', 'b'].map(id => ({ id, name: id, sessionId: id, connected: true, score: 0 })),
        state: 'LOBBY', currentRound: 1, maxRounds: 1, activeCreatorIndex: 0, currentVotes: {}, currentPrompt: '', currentVideoUrl: '',
        options: gameOptions({ mode, phaseSeconds: 60 }) };
}
const clips = ['1', '2', '3'].map(id => ({ id, creatorId: 'old-user', creatorName: 'Original', prompt: `Private prompt ${id}`, videoUrl: `/api/videos/videos/${id}.mp4` }));

test('phase deadlines survive reload, reset only on transitions and never run during generation', () => {
    const r = room(); startRounds(r); syncPhase(r, 1000);
    assert.equal(r.phaseDeadline, 61000); syncPhase(r, 2000); assert.equal(r.phaseDeadline, 61000);
    const restored = structuredClone(r); syncPhase(restored, 4000); assert.equal(restored.phaseDeadline, 61000);
    restored.state = 'GENERATING'; syncPhase(restored); assert.equal(restored.phaseDeadline, undefined);
    assert.equal(closePhase(restored), undefined); assert.equal(restored.state, 'GENERATING');
    assert.throws(() => gameOptions({ phaseSeconds: -1 })); assert.throws(() => gameOptions({ phaseSeconds: '60' }));
});
test('skipping input and timing out missing votes cannot manufacture scores or invalid persisted votes', () => {
    const r = room(); startRounds(r); assert.equal(closePhase(r), 'skipped'); assert.equal(r.state, 'RESULTS');
    assert.equal(closePhase(r), 'advanced'); assert.equal(r.players[r.activeCreatorIndex].id, 'b');
    r.state = 'VOTING'; r.currentVideoUrl = '/assets/mock-video.mp4';
    assert.equal(closePhase(r), 'voted'); assert.equal(r.state, 'GAME_OVER'); assert.equal(r.players[1].score, 0);
    assert.deepEqual(roundInput(r).votes, []); assert.equal(closePhase(r), undefined);
});
test('unfinished guessing reviews expire without awarding unconfirmed bonus points', () => {
    const r = room(); r.options = gameOptions({ guessPrompt: true }); startRounds(r); r.state = 'VOTING';
    recordVote(r, r.players[1], { points: 4, guess: 'jump' }); assert.equal(finishVoting(r), false);
    assert.equal(r.state, 'GUESS_REVIEW'); assert.equal(closePhase(r), 'voted'); assert.equal(r.players[0].score, 4); assert.equal(r.players[1].score, 0);
});
test('archive voting includes the curator, hides queued prompts and never gives original creation points again', () => {
    const r = room('archive-vote'); assert.equal(archiveCapacity(clips, 2).aiRoundLimit, 1);
    prepareArchive(r, clips); assert.equal(r.archiveClips?.length, 2); startRounds(r); playArchiveVideo(r);
    assert.equal(r.state, 'VOTING'); assert.equal(roomSnapshot(r, 'b').reveal, undefined);
    assert.doesNotMatch(JSON.stringify(roomSnapshot(r, 'b')), /Private prompt/);
    recordVote(r, r.players[0], { points: 5 }); assert.equal(finishVoting(r), false);
    recordVote(r, r.players[1], { points: 4 }); assert.equal(finishVoting(r), true);
    assert.equal(r.players[0].score, 0); assert.equal(r.archiveResults?.[0].points, 9);
    const first = r.archiveCurrent?.id; advanceTurn(r); playArchiveVideo(r); assert.notEqual(r.archiveCurrent?.id, first);
    assert.throws(() => prepareArchive(room('archive-vote'), []));
});
test('archive guessing rotates the judge and awards only confirmed guessing points', () => {
    const r = room('archive-guess'); prepareArchive(r, clips); startRounds(r); playArchiveVideo(r);
    recordVote(r, r.players[1], { points: 5, guess: 'right' }); assert.equal(finishVoting(r), false);
    assert.ok(roomSnapshot(r, 'a').reviewPrompt); assert.equal(roomSnapshot(r, 'b').reviewPrompt, undefined);
    assert.equal(judgeGuesses(r, r.players[0], { videoNumber: 1, correctPlayerIds: ['b'] }), true);
    finishVoting(r); assert.equal(r.players[0].score, 0); assert.equal(r.players[1].score, 2);
});
