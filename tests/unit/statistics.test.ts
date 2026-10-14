import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyResponse, deleteStoredHistory, purgeDeletedVideos } from '../../src/server/statistics';
import { deleteArchivedVideo } from '../../src/storage/archive';
import type { GameRepository } from '../../src/database/repository';

test('history deletion requires a same-origin signed-in request and a valid resource', async () => {
    let calls = 0;
    const remove = async () => { calls++; };
    const url = 'https://game.test/api/stats/rooms/TEST/videos/1';
    assert.equal((await historyResponse(new Request(url, { method: 'DELETE' }), {}, remove)).status, 403);
    assert.equal((await historyResponse(new Request(url, { method: 'DELETE', headers: { origin: 'https://game.test' } }), {}, remove)).status, 401);
    const config = { AUTH_MODE: 'disabled', AI_PROVIDER: 'mock' };
    assert.equal((await historyResponse(new Request(url.replace('/1', '/0'), { method: 'DELETE', headers: { origin: 'https://game.test' } }), config, remove)).status, 400);
    assert.equal(calls, 0);
    assert.equal((await historyResponse(new Request(url, { method: 'DELETE', headers: { origin: 'https://game.test' } }), config, remove)).status, 200);
    assert.equal(calls, 1);
});

test('video deletion schedules a reversible soft delete without touching files, scores or votes', async () => {
    const calls: string[] = [];
    const video = { id: '12', roomCode: 'TEST', roundNumber: 1, videoUrl: '/api/videos/videos/1234567890123-test.mp4' };
    const database = { historyVideos: async () => [video], savedVideo: async () => video,
        trashVideo: async () => { calls.push('soft-delete'); return { undoUntil: Date.now() + 30000 }; },
        roomExists: async () => true, deleteRoom: async () => { calls.push('room'); } } as unknown as GameRepository;
    await assert.rejects(deleteStoredHistory(database, { code: 'TEST', roundNumber: 1 }, async () => { throw new Error('Scheduler down'); }));
    assert.deepEqual(calls, []);
    const result = await deleteStoredHistory(database, { code: 'TEST', roundNumber: 1 }, async time => { assert.ok(time > Date.now()); calls.push('schedule'); });
    assert.ok(result.undoUntil! > Date.now());
    assert.deepEqual(calls, ['schedule', 'soft-delete']);
    await deleteStoredHistory(database, { code: 'TEST' }, async () => { throw new Error('Room deletion must not schedule file deletion'); });
    assert.deepEqual(calls, ['schedule', 'soft-delete', 'room']);
});

test('video restore is same-origin, uses immutable IDs and rejects expired undo windows', async () => {
    const video = { id: '42', roomCode: 'TEST', roundNumber: 1, roomDeleted: true } as any;
    const config = { AUTH_MODE: 'disabled', AI_PROVIDER: 'mock' };
    let calls = 0;
    const execute = async (command: any) => { calls++; assert.equal(command.videoId, '42'); assert.equal(command.restore, true); };
    const url = 'https://game.test/api/stats/videos/42/restore';
    assert.equal((await historyResponse(new Request(url, { method: 'POST' }), config, execute, async () => video)).status, 403);
    assert.equal((await historyResponse(new Request(url, { method: 'DELETE' }), config, execute, async () => video)).status, 405);
    assert.equal((await historyResponse(new Request(url, { method: 'POST', headers: { origin: 'https://game.test' } }), config, execute, async () => video)).status, 200);
    assert.equal(calls, 1);
    const database = { savedVideo: async () => video, restoreVideo: async () => false } as unknown as GameRepository;
    await assert.rejects(deleteStoredHistory(database, { code: 'TEST', roundNumber: 1, videoId: '42', restore: true }, async () => {}), /Frist/);
});

test('permanent cleanup removes only expired videos and keeps failed storage deletions retryable', async () => {
    const removed: string[] = [], finalized: string[] = [];
    const database = { expiredVideos: async () => [{ id: '1', videoUrl: 'first' }, { id: '2', videoUrl: 'second' }],
        finalizeVideoDeletion: async (id: string) => { finalized.push(id); } } as unknown as GameRepository;
    await assert.rejects(purgeDeletedVideos(database, async url => { if (url === 'first') throw new Error('Storage down'); removed.push(url); }), /noch nicht/);
    assert.deepEqual(removed, ['second']); assert.deepEqual(finalized, ['2']);
});

test('archive deletion is idempotent and never deletes mock files or external URLs', async () => {
    const original = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = async (input, init) => {
        requests.push(input instanceof Request ? input : new Request(input, init));
        return new Response(null, { status: 404 });
    };
    try {
        const config = { AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_ENDPOINT_URL_S3: 'https://storage.test' };
        await deleteArchivedVideo('/assets/mock-video.mp4', config);
        await deleteArchivedVideo('https://demo.hf.space/file.mp4', config);
        assert.equal(requests.length, 0);
        await deleteArchivedVideo('/api/videos/videos/1234567890123-test.mp4', config);
        assert.equal(requests[0].method, 'DELETE');
        assert.match(requests[0].headers.get('authorization')!, /^AWS4-HMAC-SHA256/);
        await assert.rejects(deleteArchivedVideo('/api/videos/../private-file', config));
        assert.equal(requests.length, 1);
    } finally { globalThis.fetch = original; }
});
