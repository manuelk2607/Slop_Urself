import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkJoin, prepareRematch, resetReady, startProblem } from '../../src/game/participants';
import { gameOptions } from '../../src/game/options';
import { recordVote, roomSnapshot, type Room } from '../../src/game/rules';
function fixture(): Room {
    return { code: 'TEST', hostId: 'a', players: ['a', 'b'].map(id => ({ id, name: id, accountId: id, sessionId: `session-${id}`, connected: true, ready: true, score: 7, hfConnectionId: `private-${id}` })),
        spectators: [{ id: 's', name: 'Viewer', sessionId: 'secret-viewer-session', connected: true, score: 0 }], state: 'LOBBY', currentRound: 1, maxRounds: 1, activeCreatorIndex: 0, currentVotes: {}, currentPrompt: 'secret-prompt', currentVideoUrl: '', options: gameOptions() };
}
test('ready check is optional, ignores spectators and resets on changes', () => {
    const room = fixture(); room.players[1].ready = false;
    assert.equal(startProblem(room), undefined);
    room.options = gameOptions({ requireReady: true }); assert.match(startProblem(room)!, /bereit/);
    room.players[1].ready = true; room.spectators![0].connected = false; assert.equal(startProblem(room), undefined);
    room.players[1].connected = false; assert.match(startProblem(room)!, /verbunden/);
    resetReady(room); assert.ok(room.players.every(p => !p.ready));
});
test('spectator snapshots have no capabilities, sessions, private tasks or unrevealed guesses', () => {
    const room = fixture(); room.state = 'VOTING'; room.tasks = { a: 'secret-task' }; room.guesses = { b: { text: 'private-guess' } };
    const text = JSON.stringify(roomSnapshot(room, 's'));
    assert.doesNotMatch(text, /private-a|private-b|session-|secret-prompt|secret-task|private-guess/);
    assert.equal(roomSnapshot(room, 's').role, 'spectator');
    assert.throws(() => recordVote(room, room.spectators![0], { points: 5 }), /Zuschauer/);
    assert.deepEqual(room.currentVotes, {});
});
test('join limits and identity conflicts cover players and spectators, including running games', () => {
    const room = fixture(); room.state = 'IDLE';
    assert.throws(() => checkJoin(room, 'new', undefined, false), /gestartet/);
    assert.doesNotThrow(() => checkJoin(room, 'new', undefined, true));
    assert.throws(() => checkJoin(room, 'VIEWER', undefined, true), /bereits/);
    assert.throws(() => checkJoin(room, 'other', 'a', true), /bereits/);
    room.spectators = Array.from({ length: 20 }, (_, i) => ({ ...room.players[0], id: `s${i}` }));
    assert.throws(() => checkJoin(room, 'new', undefined, true), /20/);
    room.state = 'LOBBY'; room.players = Array.from({ length: 10 }, (_, i) => ({ ...room.players[0], id: `p${i}` }));
    assert.throws(() => checkJoin(room, 'new', undefined, false), /10/);
});
test('rematch copies only options/group with new identities, no scores, images, jobs or history mutation', () => {
    const room = fixture(); room.state = 'GAME_OVER'; room.options = gameOptions({ sharedImage: true, secretTasks: true, requireReady: true });
    room.currentVideoUrl = '/old.mp4'; room.tasks = { a: 'old-task' };
    const original = structuredClone(room), plan = prepareRematch(room, 'NEXT'), next = plan.room;
    assert.deepEqual(room, original); assert.equal(next.players.length, 2); assert.equal(next.spectators!.length, 1);
    for (const player of [...next.players, ...next.spectators!]) { assert.equal(player.score, 0); assert.equal(player.ready, false); assert.ok(!JSON.stringify(original).includes(player.sessionId)); }
    assert.equal(next.hostId, plan.transfers.a.playerId); assert.deepEqual(next.options, room.options);
    assert.equal(next.currentVideoUrl, ''); assert.equal(next.currentPrompt, ''); assert.equal(next.sharedImage, undefined); assert.equal(next.tasks, undefined); assert.equal(next.generationJob, undefined);
});
