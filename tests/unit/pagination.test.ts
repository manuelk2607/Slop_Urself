import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyCursor, historyPage } from '../../src/database/pagination';
import type { VideoStats } from '../../src/database/types';
import { GameRepository } from '../../src/database/repository';
import { VIDEOS_SQL, ROOMS_SQL } from '../../src/database/statistics';

test('history cursors preserve microseconds and immutable tie breakers and reject malformed input', () => {
    const rows = [{ id: '42', createdAt: '2026-10-14T12:34:56.123456Z' }, { id: '41', createdAt: '2026-10-14T12:34:56.123456Z' }] as VideoStats[];
    const page = historyPage(rows, 1);
    assert.deepEqual(historyCursor(page.nextCursor, 'videos'), { at: rows[0].createdAt, id: '42' });
    assert.equal(historyPage(rows, 2).nextCursor, null);
    for (const value of ['', 'bad!', 'x'.repeat(301), btoa('null'), btoa(JSON.stringify({ id: '9223372036854775808', at: rows[0].createdAt }))]) {
        assert.throws(() => historyCursor(value, 'videos'), /Ungültige/);
    }
    assert.equal(historyCursor(null, 'videos'), undefined);
});

test('video and room pagination uses parameterized keysets with one lookahead row', async () => {
    const queries: { text: string; values?: unknown[] }[] = [];
    const repository = new GameRepository({ transaction: async () => {}, query: async <T>(query: { text: string; values?: unknown[] }) => { queries.push(query); return [] as T[]; } });
    await repository.videoPage('friend', { at: '2026-10-14T12:34:56.123456Z', id: '42' });
    await repository.roomPage({ at: '2026-10-14T12:34:56.123456Z', id: 'ABCD' });
    assert.deepEqual(queries[0].values, ['friend', '2026-10-14T12:34:56.123456Z', '42']);
    assert.deepEqual(queries[1].values, ['2026-10-14T12:34:56.123456Z', 'ABCD']);
    assert.match(VIDEOS_SQL, /\(h.created_at, h.id\) </); assert.match(VIDEOS_SQL, /limit 13/);
    assert.match(ROOMS_SQL, /\(r.created_at, r.code\) </); assert.match(ROOMS_SQL, /limit 51/);
});
