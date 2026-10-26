import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArchiveReservations, ARCHIVE_LEASE_MS } from '../../src/storage/reservations';
import { evictionPlan } from '../../src/storage/archive';
import { ServiceDurableObject } from '../../src/server/cloudflare/worker';
test('persisted active-room leases protect playback across service eviction, renew and expire', async () => {
    const data = new Map<string, unknown>(); let writes = 0;
    const storage = { get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); writes++; } };
    const url = '/api/videos/videos/1792000000000-active.mp4';
    const leases = new ArchiveReservations(storage);
    await leases.protect('ABCD', url, 100); await leases.protect('ABCD', url, 101); assert.equal(writes, 1);
    const restarted = new ArchiveReservations(storage);
    assert.deepEqual(await restarted.activeUrls(102), [url]);
    const protectedKeys = new Set((await restarted.activeUrls(102)).map(u => u.slice('/api/videos/'.length)));
    const files = [{ key: url.slice('/api/videos/'.length), size: 40, modified: '2026-01-01' }, { key: 'videos/1792000000000-unused.mp4', size: 40, modified: '2026-02-01' }];
    assert.deepEqual(evictionPlan(files, 50, 100, protectedKeys).map(f => f.key), ['videos/1792000000000-unused.mp4']);
    await restarted.protect('ABCD', url, ARCHIVE_LEASE_MS / 2 + 101); assert.equal(writes, 2);
    assert.deepEqual(await restarted.activeUrls(ARCHIVE_LEASE_MS + 101), [url]);
    assert.deepEqual(await restarted.activeUrls(2 * ARCHIVE_LEASE_MS + 200), []);
    await assert.rejects(leases.protect('bad', url));
});

test('actual archive queue refuses FIFO deletion of an active room file after Services recreation', async () => {
    const data = new Map<string, unknown>(), original = globalThis.fetch;
    const state = { storage: { get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } } };
    const config = { AI_PROVIDER: 'mock', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_ENDPOINT_URL_S3: 'https://storage.test', VIDEO_ARCHIVE_MB: '20' };
    const live = '/api/videos/videos/1792000000000-live.mp4'; let deletes = 0, puts = 0;
    const first = new ServiceDurableObject(state as never, config as never);
    const protection = await first.fetch(new Request('https://internal/archive/protect', { method: 'POST', body: JSON.stringify({ code: 'ABCD', url: live }) }));
    assert.equal(protection.status, 200);
    const restarted = new ServiceDurableObject(state as never, config as never);
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url.startsWith('https://demo.hf.space/')) return new Response(Uint8Array.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]));
        if (request.url.includes('list-type')) return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${live.slice('/api/videos/'.length)}</Key><Size>${20 * 1024 * 1024}</Size><LastModified>2026-01-01</LastModified></Contents></ListBucketResult>`);
        if (request.method === 'DELETE') deletes++;
        if (request.method === 'PUT') puts++;
        throw new Error('No active object may be modified');
    };
    try {
        const result = await restarted.fetch(new Request('https://internal/archive', { method: 'POST', body: JSON.stringify({ code: 'EFGH', url: 'https://demo.hf.space/result.mp4' }) }));
        assert.equal(result.status, 503); assert.equal(deletes, 0); assert.equal(puts, 0);
    } finally { globalThis.fetch = original; }
});
