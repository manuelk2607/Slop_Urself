import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArchiveReservations, ARCHIVE_LEASE_MS } from '../../src/storage/reservations';
import { evictionPlan } from '../../src/storage/archive';
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
