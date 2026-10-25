import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startRounds, advanceTurn, recordVote, removePlayer, roomSnapshot, finishVoting, type Room } from '../../src/game/rules';
import { roundInput } from '../../src/game/persistence';

function game(): Room {
    const r: Room = { code: 'TEST', hostId: 'a', players: ['a', 'b', 'c'].map(id => ({ id, name: id, sessionId: id, connected: true, score: 0 })),
        state: 'LOBBY', activeCreatorIndex: 0, currentVotes: {}, currentRound: 1, maxRounds: 2, currentPrompt: 'wave', currentVideoUrl: '/video' };
    startRounds(r); r.state = 'VOTING'; return r;
}
test('votes require the exact ballot, video and round; duplicate acceptance stays idempotent', () => {
    const r = game(), vote = { ...roomSnapshot(r), points: 5 };
    for (const invalid of [{}, { ...vote, ballotId: 'stale' }, { ...vote, videoNumber: 0 }, { ...vote, currentRound: 2 }, { ...vote, videoNumber: '1' }]) {
        assert.throws(() => recordVote(r, r.players[1], invalid), /anderen Video/);
        assert.deepEqual(r.currentVotes, {});
    }
    recordVote(r, r.players[1], vote); recordVote(r, r.players[1], { ...vote, points: 1 });
    assert.equal(r.currentVotes.b, 5);
    const restored = structuredClone(r); assert.equal(roomSnapshot(restored).ballotId, vote.ballotId);
    recordVote(r, r.players[2], vote); finishVoting(r); advanceTurn(r); r.state = 'VOTING';
    assert.throws(() => recordVote(r, r.players[0], vote), /anderen Video/);
    assert.notEqual(roomSnapshot(r).ballotId, vote.ballotId);
});
test('leaving preserves accepted votes/details and persists them without waiting for departed voters', () => {
    const r = game(), vote = roomSnapshot(r);
    recordVote(r, r.players[1], { ...vote, points: 5 });
    r.voteDetails = { b: { taskPoints: 5, funPoints: 5 } };
    removePlayer(r, 'b');
    assert.equal(r.currentVotes.b, 5); assert.deepEqual(r.voteDetails.b, { taskPoints: 5, funPoints: 5 });
    recordVote(r, r.players[1], { ...vote, points: 3 });
    assert.equal(finishVoting(r), true); assert.equal(r.players[0].score, 8);
    assert.deepEqual(roundInput(r).votes.map(v => v.voterSocketId).sort(), ['b', 'c']);
    assert.equal(finishVoting(r), false);
});
test('creator leaving invalidates the ballot even if a video counter is reused', () => {
    const r = game(), old = roomSnapshot(r); removePlayer(r, 'a'); r.state = 'VOTING';
    assert.notEqual(roomSnapshot(r).ballotId, old.ballotId);
    assert.throws(() => recordVote(r, r.players[1], { ...old, points: 5 }), /anderen Video/);
});
