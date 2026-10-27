import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginViewing, confirmPreview, finishVoting, recordVote, roomSnapshot, startRounds, removePlayer, type Room } from '../../src/game/rules';
import { roundInput } from '../../src/game/persistence';
function game(): Room {
    const room: Room = { code: 'TEST', hostId: 'a', players: ['a', 'b', 'c'].map(id => ({ id, name: id, sessionId: id, score: 0, connected: true })), state: 'LOBBY', activeCreatorIndex: 0, currentVotes: {}, currentRound: 1, maxRounds: 2, currentVideoUrl: '/video', currentPrompt: 'wave' };
    startRounds(room); room.state = 'VOTING'; beginViewing(room, 1000); return room;
}
test('early votes wait for creator preview confirmation and survive reload; no indefinite creator hold', () => {
    const room = game(), context = roomSnapshot(room);
    recordVote(room, room.players[1], { ...context, points: 4 }); recordVote(room, room.players[2], { ...context, points: 5 });
    assert.equal(finishVoting(room, false, false, 2000), false); assert.equal(room.players[0].score, 0);
    const restored = structuredClone(room);
    assert.equal(confirmPreview(restored, restored.players[1], context), false);
    assert.throws(() => confirmPreview(restored, restored.players[0], { ...context, ballotId: 'old' }));
    assert.equal(confirmPreview(restored, restored.players[0], context), true);
    assert.equal(finishVoting(restored, false, false, 2000), true); assert.equal(restored.players[0].score, 9);
    assert.equal(finishVoting(room, false, false, 46_000), true, 'After the bounded window a missing creator acknowledgement cannot deadlock.');
});
test('departed accepted votes stay in progress totals and group preview retains its deadline with only its creator left', () => {
    const room = game(), context = roomSnapshot(room);
    recordVote(room, room.players[1], { ...context, points: 4 });
    removePlayer(room, 'b');
    assert.deepEqual(roomSnapshot(room).voting, { voted: 1, total: 2 });
    removePlayer(room, 'c');
    assert.deepEqual(roomSnapshot(room).voting, { voted: 1, total: 1 });
    assert.equal(finishVoting(room, false, false, 2000), false);
    assert.equal(finishVoting(room, false, false, 46_000), true);
    assert.equal(room.players[0].score, 4); assert.deepEqual(room.currentVotes, { b: 4 });
});
test('explicit abstention is video-bound, irreversible like a vote and never persisted as a zero-star rating', () => {
    const room = game(), context = roomSnapshot(room);
    assert.throws(() => recordVote(room, room.players[1], { ...context, ballotId: 'old', abstain: true }));
    recordVote(room, room.players[1], { ...context, abstain: true });
    recordVote(room, room.players[1], { ...context, points: 5 }); assert.equal(room.currentVotes.b, 0);
    assert.equal(roomSnapshot(room, 'b').hasAbstained, true); assert.equal(roomSnapshot(room, 'c').hasAbstained, false);
    recordVote(room, room.players[2], { ...context, points: 4 });
    assert.equal(finishVoting(room, true), true); assert.equal(room.lastResult?.abstentions, 1);
    assert.deepEqual(roundInput(room).votes, [{ voterSocketId: 'c', points: 4 }]);
    assert.equal(room.players[0].score, 4);
});
