import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRounds, recordVote as rawRecordVote, finishVoting, judgeGuesses, roomSnapshot, removePlayer, advanceTurn, type Room } from '../../src/game/rules';
import { gameOptions } from '../../src/game/options';
import { roundInput } from '../../src/game/persistence';
import { preparedImageSize } from '../../src/ai/images';
import { writeSharedImage, readSharedImage, deleteSharedImage, sharedImageResponse } from '../../src/game/images';
import { providerBudgets, qualityConfig, DEFAULT_PROVIDER_CHAIN } from '../../src/ai/providers';
import { QuotaBudget } from '../../src/ai/quota';
import { testImageData } from '../support/images';
const recordVote: typeof rawRecordVote = (r, player, payload) => rawRecordVote(r, player, { ...roomSnapshot(r), ...payload });

function room(): Room {
    const value: Room = { code: 'TEST', hostId: 'a', players: ['a', 'b', 'c'].map(id => ({ id, name: id, sessionId: `session-${id}`, connected: true, score: 0 })),
        state: 'LOBBY', maxRounds: 2, currentRound: 1, activeCreatorIndex: 0, currentVotes: {}, currentPrompt: '', currentVideoUrl: '',
        options: gameOptions({ secretTasks: true, guessPrompt: true, sharedImage: true }) };
    startRounds(value); value.state = 'VOTING'; value.currentPrompt = 'private prompt'; return value;
}
test('classic is the default: personal uploads, ordinary votes and no task or guessing phase', () => {
    assert.deepEqual(gameOptions(), { requireReady: false, sharedImage: false, secretTasks: false, guessPrompt: false, quality: 'auto', mode: 'classic', phaseSeconds: 0 });
    const r = room(); r.options = gameOptions(); startRounds(r); r.state = 'VOTING';
    assert.deepEqual(r.tasks, {});
    assert.equal(roomSnapshot(r, 'a').ownTask, undefined);
    recordVote(r, r.players[1], { points: 4 }); recordVote(r, r.players[2], { points: 5 });
    assert.equal(finishVoting(r), true); assert.equal(r.state, 'RESULTS'); assert.equal(r.players[0].score, 9);
    assert.deepEqual(r.guesses, {}); assert.deepEqual(r.voteDetails, {});
});
test('secret assignments and guesses are private, persist across snapshots and award bonuses exactly once', () => {
    const r = room(); assert.equal(new Set(Object.values(r.tasks!)).size, 3);
    assert.equal(roomSnapshot(r, 'b').ownTask, undefined);
    assert.equal(roomSnapshot(r, 'b').reviewPrompt, undefined);
    assert.ok(roomSnapshot(r, 'a').ownTask);
    recordVote(r, r.players[1], { taskPoints: 5, funPoints: 3, guess: 'turn around' });
    recordVote(r, r.players[1], { taskPoints: 1, funPoints: 1, guess: 'overwrite' });
    recordVote(r, r.players[2], { taskPoints: 2, funPoints: 4, guess: 'run' });
    assert.equal(finishVoting(r), false); assert.equal(r.state, 'GUESS_REVIEW');
    assert.equal(roomSnapshot(r, 'a').reviewGuesses?.length, 2);
    assert.equal(roomSnapshot(r, 'b').reviewGuesses, undefined);
    assert.equal(roomSnapshot(r, 'b').reveal, undefined);
    assert.equal(judgeGuesses(r, r.players[1], { videoNumber: 1, correctPlayerIds: ['b'] }), false);
    assert.throws(() => judgeGuesses(r, r.players[0], { videoNumber: 1, correctPlayerIds: ['b', 'b'] }));
    assert.equal(judgeGuesses(r, r.players[0], { videoNumber: 1, correctPlayerIds: ['b'] }), true);
    assert.equal(finishVoting(r), true); assert.equal(r.players[0].score, 7); assert.equal(r.players[1].score, 2);
    assert.equal(judgeGuesses(r, r.players[0], { videoNumber: 1, correctPlayerIds: ['b'] }), false);
    assert.equal(finishVoting(r), false);
    assert.equal(roomSnapshot(r, 'c').reveal?.prompt, 'private prompt');
    const input = roundInput(r);
    assert.equal(input.guesses?.find(guess => guess.playerId === 'b')?.points, 2);
    assert.deepEqual(input.votes[0], { voterSocketId: 'b', points: 4, taskPoints: 5, funPoints: 3 });
    assert.equal(input.taskText, r.tasks!.a);
    advanceTurn(r); assert.deepEqual(r.guesses, {}); assert.equal(roomSnapshot(r, 'b').ownTask, r.tasks!.b);
});
test('skipped guesses do not stall voting; leaving during review cannot duplicate bonuses or waste another turn', () => {
    const r = room();
    recordVote(r, r.players[1], { taskPoints: 3, funPoints: 3, guess: '' });
    recordVote(r, r.players[2], { taskPoints: 3, funPoints: 3, guess: '' });
    assert.equal(finishVoting(r), true);
    const review = room();
    recordVote(review, review.players[1], { taskPoints: 3, funPoints: 3, guess: 'wave' });
    recordVote(review, review.players[2], { taskPoints: 3, funPoints: 3, guess: '' });
    finishVoting(review); removePlayer(review, 'b');
    assert.equal(finishVoting(review), false, 'Accepted guesses remain reviewable after their author leaves.');
    judgeGuesses(review, review.players[0], { videoNumber: 1, correctPlayerIds: [] });
    assert.equal(finishVoting(review), true); assert.equal(review.players[0].score, 6);
    const leavingCreator = room(); leavingCreator.state = 'GUESS_REVIEW';
    assert.equal(removePlayer(leavingCreator, 'a'), 1, 'Only the next cycle is still unconsumed.');
    assert.equal(leavingCreator.state, 'IDLE'); assert.equal(leavingCreator.players[leavingCreator.activeCreatorIndex].id, 'b');
});
test('five-minute quota uses live remaining seconds, measured safety costs and no automatic LTX fallback', async () => {
    assert.equal(DEFAULT_PROVIDER_CHAIN, 'wan22,wan22-fast');
    const config = { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: DEFAULT_PROVIDER_CHAIN, AI_IMAGE_PROFILE: 'bounded', LTX_DURATION: '5' };
    assert.deepEqual(providerBudgets(config).map(provider => provider.gpuSeconds), [126, 79]);
    assert.deepEqual(providerBudgets(qualityConfig(config, 'quality')).map(provider => provider.id), ['wan22']);
    assert.deepEqual(providerBudgets(qualityConfig(config, 'economy')).map(provider => provider.id), ['wan22-fast']);
    assert.equal(qualityConfig({ ...config, AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' }).AI_PROVIDER_CHAIN, DEFAULT_PROVIDER_CHAIN);
    const data = new Map<string, any>(), original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 300, current: 300, resetsAt: null, runs: { remaining: 8 } });
    const budget = new QuotaBudget({ get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, config);
    try {
        assert.equal((await budget.capacity(2)).totalGpuSeconds, 300);
        assert.equal((await budget.capacity(2)).availableGenerations, 3);
        assert.equal((await budget.capacity(2)).aiRoundLimit, 1);
        assert.equal((await budget.capacity(2, 'quality')).aiRoundLimit, 1);
        await assert.rejects(budget.reserve('TEST', 2, 2));
        await budget.reserve('TEST', 1, 2); assert.equal(data.get('reservations').TEST.rounds, 2);
        await budget.begin('TEST', 2, 'job');
        await budget.allowAttempt('TEST', 126, 'job');
        const held = (await budget.capacity(1)).availableGenerations; assert.equal(held, 1);
        await budget.allowAttempt('TEST', 79, 'job');
    } finally { globalThis.fetch = original; }
});
test('prepared image validation and chunked ephemeral room images survive reload, enforce expiry and clean up', async () => {
    const data = testImageData(832, 624, true), values = new Map<string, any>();
    const storage = { get: async <T>(key: string) => values.get(key) as T, put: async (key: string, value: unknown) => { assert.ok(String(value).length <= 65536); values.set(key, value); }, delete: async (key: string) => { values.delete(key); } };
    assert.deepEqual(preparedImageSize(data.split(',')[1]), { width: 832, height: 624 });
    assert.throws(() => preparedImageSize(testImageData(832, 832).split(',')[1]));
    const image = await writeSharedImage(storage, data); assert.ok(image.chunks > 1);
    assert.equal(await readSharedImage(storage, structuredClone(image)), data);
    const url = `https://game.test/api/rooms/TEST/image?id=${image.id}`;
    assert.equal((await sharedImageResponse(new Request(url), storage, image)).status, 200);
    assert.equal((await sharedImageResponse(new Request(url + 'wrong'), storage, image)).status, 404);
    assert.equal((await sharedImageResponse(new Request(url), storage, { ...image, expiresAt: Date.now() - 1 })).status, 410);
    await deleteSharedImage(storage, image); assert.equal(values.size, 0);
});
