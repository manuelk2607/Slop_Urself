import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, finishVoting, removePlayer, activeCreator, roomSnapshot, finalStandings, playerForConnection, startRounds, advanceTurn, extendRound } from '../../src/game/rules';

function room(): Room {
    return { code: 'TEST', hostId: 'a', players: ['a', 'b', 'c'].map(id => ({
        id, sessionId: `secret-${id}`, connectionId: `socket-${id}`, name: id, score: 0, connected: true
    })), state: 'VOTING', activeCreatorIndex: 0, currentVotes: { b: 4, c: 5 },
        currentRound: 1, maxRounds: 2, currentPrompt: 'wave', currentVideoUrl: '/assets/mock-video.mp4' };
}

test('simultaneous completion attempts score the round once', () => {
    const r = room();
    assert.equal(finishVoting(r), true);
    assert.equal(finishVoting(r), false);
    assert.equal(r.players[0].score, 9);
    assert.equal(r.state, 'RESULTS');
    assert.deepEqual(r.lastResult, { authorName: 'a', roundPoints: 9 });
});

test('disconnect keeps the current author and waits for their session to resume', () => {
    const r = room(); r.players[0].connected = false;
    assert.equal(activeCreator(r)?.id, 'a');
    delete r.currentVotes.c; r.players[2].connected = false;
    assert.equal(finishVoting(r), false);
});

test('leaving before the creator in player order does not change the author', () => {
    const r = room(); r.activeCreatorIndex = 2;
    removePlayer(r, 'a');
    assert.equal(activeCreator(r)?.id, 'c');
});

test('active player leaving cancels a pending generation and rotates to the next player', () => {
    const r = room(); r.state = 'GENERATING'; r.generationId = 'old-generation';
    removePlayer(r, 'a');
    assert.equal(r.state, 'IDLE');
    assert.equal(activeCreator(r)?.id, 'b');
    assert.equal(r.generationId, undefined);
});

test('creator leaving the results screen does not skip the next player', () => {
    for (const creatorIndex of [0, 1, 2]) {
        const r = room();
        r.state = 'RESULTS'; r.activeCreatorIndex = creatorIndex;
        const creatorId = activeCreator(r)!.id;
        const nextId = r.players[(creatorIndex + 1) % r.players.length].id;
        removePlayer(r, creatorId);
        r.activeCreatorIndex = (r.activeCreatorIndex + 1) % r.players.length;
        assert.equal(activeCreator(r)?.id, nextId);
    }
});

test('snapshots restore results and votes without exposing session secrets', () => {
    const r = room(); finishVoting(r);
    const s = roomSnapshot(r);
    assert.equal(s.lastResult?.roundPoints, 9);
    assert.deepEqual(s.votedPlayerIds, ['b', 'c']);
    assert.equal(JSON.stringify(s).includes('secret-'), false);
    assert.equal(JSON.stringify(s).includes('socket-'), false);
});

test('reconnect changes the connection without changing persistence identity', () => {
    const r = room(); r.players[0].connectionId = 'new-socket';
    assert.equal(playerForConnection(r, 'new-socket')?.id, 'a');
    assert.equal(playerForConnection(r, 'socket-a'), undefined);
});

test('solo preview lasts ten seconds and final ties receive the same rank', () => {
    const r = room(); r.players = [r.players[0]]; r.currentVotes = {}; r.soloFinishAt = 10_000;
    assert.equal(finishVoting(r, 9_999), false);
    assert.equal(finishVoting(r, 10_000), true);
    const tied = room(); tied.players[0].score = 5; tied.players[1].score = 5;
    assert.deepEqual(finalStandings(tied).map(p => p.finalRank), [1, 1, 3]);
});

test('two full rounds give every player two videos with distinct persistence numbers', () => {
    const r = room(); startRounds(r);
    const creators: string[] = [];
    const rounds: number[] = [];
    const videos: number[] = [];
    for (let turn = 0; turn < 6; turn++) {
        const creator = activeCreator(r)!;
        creators.push(creator.id); rounds.push(r.currentRound); videos.push(r.videoNumber!);
        r.state = 'VOTING';
        r.currentVotes = Object.fromEntries(r.players.filter(p => p.id !== creator.id).map(p => [p.id, 1]));
        assert.equal(finishVoting(r), true);
        assert.equal(r.state, turn === 5 ? 'GAME_OVER' : 'RESULTS');
        if (turn < 5) advanceTurn(r);
    }
    assert.deepEqual(creators, ['a', 'b', 'c', 'a', 'b', 'c']);
    assert.deepEqual(rounds, [1, 1, 1, 2, 2, 2]);
    assert.deepEqual(videos, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(r.players.map(p => p.score), [4, 4, 4]);
});

test('leavers lose pending turns without giving other players extra videos', () => {
    const r = room(); startRounds(r);
    r.state = 'VOTING'; r.currentVotes = { b: 1, c: 1 }; finishVoting(r);
    assert.equal(roomSnapshot(r).nextRound, 1);
    assert.equal(removePlayer(r, 'b'), 2);
    advanceTurn(r);
    assert.equal(activeCreator(r)?.id, 'c'); assert.equal(r.currentRound, 1);
    r.state = 'VOTING'; r.currentVotes = { a: 1 }; finishVoting(r);
    assert.equal(roomSnapshot(r).nextRound, 2);
    advanceTurn(r);
    assert.equal(activeCreator(r)?.id, 'a'); assert.equal(r.currentRound, 2);
});

test('the last pending creator leaving finishes the game without a phantom video', () => {
    const r = room(); r.maxRounds = 1; startRounds(r);
    for (const points of [{ b: 1, c: 1 }, { a: 1, c: 1 }]) {
        r.state = 'VOTING'; r.currentVotes = points; finishVoting(r); advanceTurn(r);
    }
    assert.equal(activeCreator(r)?.id, 'c');
    r.state = 'GENERATING';
    assert.equal(removePlayer(r, 'c'), 0, 'An in-flight generation stays reserved until its callback completes.');
    assert.equal(r.state, 'GAME_OVER');
    assert.equal(r.currentVideoUrl, ''); assert.equal(r.lastResult, undefined);
    assert.deepEqual(r.players.map(p => p.score), [2, 2]);
});

test('additional cycles preserve scores, give each remaining player one turn and keep video IDs unique', () => {
    const r = room(); r.maxRounds = 1; startRounds(r);
    for (let turn = 0; turn < 3; turn++) {
        r.state = 'VOTING'; r.currentVotes = Object.fromEntries(r.players.filter(p => p.id !== activeCreator(r)!.id).map(p => [p.id, 1]));
        finishVoting(r); if (turn < 2) advanceTurn(r);
    }
    assert.equal(r.state, 'GAME_OVER'); assert.deepEqual(r.players.map(p => p.score), [2, 2, 2]);
    r.players[1].connected = false;
    assert.throws(() => extendRound(r));
    r.players[1].connected = true; removePlayer(r, 'c');
    extendRound(r);
    assert.equal(r.currentRound, 2); assert.equal(r.maxRounds, 2); assert.equal(r.videoNumber, 4);
    assert.deepEqual(r.pendingCreators, ['a', 'b']); assert.deepEqual(r.players.map(p => p.score), [2, 2]);
    assert.equal(r.lastResult, undefined); assert.equal(r.currentVideoUrl, '');
    assert.throws(() => extendRound(r), 'Repeated commands must not append another cycle.');
    r.state = 'VOTING'; r.currentVotes = { b: 3 }; finishVoting(r); advanceTurn(r);
    assert.equal(r.videoNumber, 5); assert.equal(activeCreator(r)!.id, 'b');
    r.state = 'VOTING'; r.currentVotes = { a: 4 }; finishVoting(r);
    assert.equal(r.state, 'GAME_OVER'); assert.deepEqual(r.players.map(p => p.score), [5, 6]);
});
