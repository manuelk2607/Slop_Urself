import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Response } from 'miniflare';
import { cloudflareRuntime } from '../support/cloudflare';

// Only the external Neon HTTP/S3 contracts are stubbed. Worker routing, queues, storage and alarms run in workerd.
const bytes = await readFile('public/assets/mock-video.mp4');
const key = 'videos/1234567890123-runtime.mp4', videoUrl = `/api/videos/${key}`;
const video = { id: '101', roomCode: 'DONE', roundNumber: 1, creatorId: 'friend', creatorName: 'Friend',
    prompt: 'The subject waves.', videoUrl, roundPoints: 5, createdAt: '2026-10-14T12:00:00.123456Z',
    roomDeleted: true, evictedAt: null as string | null };
let deadline: number | null = null, exists = true, fileDeletes = 0, finalized = false;
function rows(items: Record<string, unknown>[]) {
    const names = Object.keys(items[0] || {});
    return { fields: names.map(name => ({ name, dataTypeID: typeof items[0][name] === 'number' ? 701 : typeof items[0][name] === 'boolean' ? 16 : 25 })),
        rows: items.map(item => names.map(name => item[name] === null ? null : typeof item[name] === 'boolean' ? item[name] ? 't' : 'f' : String(item[name]))), rowCount: items.length, command: 'SELECT' };
}
function sql(query: string, params: unknown[] = []) {
    if (/^\s*(create |alter |insert into video_history)/i.test(query)) return rows([]);
    if (query.includes('set evicted_at')) {
        if (!String(params[0]).includes(videoUrl)) video.evictedAt ||= new Date().toISOString();
        return rows([]);
    }
    if (query.includes('with trashed as')) { deadline ??= Date.now() + Number(params[1]) * 1000; return rows([{ undoUntil: deadline }]); }
    if (query.includes('with restored as')) {
        if (deadline && deadline <= Date.now()) return rows([]);
        deadline = null; return rows([{ id: video.id }]);
    }
    if (query.includes('with purged as')) { finalized = true; video.videoUrl = ''; return rows([]); }
    if (query.includes('min(delete_after)')) return rows([{ deadline: finalized ? null : deadline }]);
    if (query.includes('delete_after <= clock_timestamp()')) return rows(!finalized && deadline && deadline <= Date.now() ? [{ id: video.id, videoUrl }] : []);
    if (query.includes('where h.id = $1')) return rows(finalized ? [] : [{ ...video, deleteAfter: deadline ? new Date(deadline).toISOString() : null }]);
    if (query.includes('from video_history h')) return rows(!finalized && !deadline ? [video] : []);
    if (query.includes('as "gamesPlayed"') && query.includes('from rooms')) return rows([{ gamesPlayed: 0, completedGames: 0, roundsPlayed: 0, votesCast: 0, videosArchived: !finalized && !deadline && !video.evictedAt ? 1 : 0, highestScore: 0 }]);
    if (query.includes('with player_totals') || query.includes('from rooms r') || query.includes('group by creator_id')) return rows([]);
    throw new Error(`Unexpected test SQL: ${query}`);
}
const runtime = await cloudflareRuntime({ bindings: { DATABASE_URL: 'postgresql://test:test@ep-runtime.neon.tech/test',
    AWS_ACCESS_KEY_ID: 'runtime-test-key', AWS_SECRET_ACCESS_KEY: 'runtime-test-secret', AWS_ENDPOINT_URL_S3: 'https://storage.test' },
    outboundService: async request => {
        const url = new URL(request.url);
        if (url.hostname === 'ep-runtime.neon.tech' || url.hostname === 'api.neon.tech') {
            assert.ok(request.headers.get('neon-connection-string')?.includes('@ep-runtime.neon.tech/test'));
            const body = await request.json() as { query?: string; params?: unknown[]; queries?: { query: string; params: unknown[] }[] };
            return Response.json(body.queries ? { results: body.queries.map(item => sql(item.query, item.params)) } : sql(body.query!, body.params));
        }
        assert.equal(url.hostname, 'storage.test', 'Real external network calls are forbidden.');
        if (url.searchParams.has('list-type')) return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${exists ? `<Contents><Key>${key}</Key><Size>${bytes.length}</Size><LastModified>2026-10-14T12:00:00Z</LastModified></Contents>` : ''}</ListBucketResult>`);
        if (request.method === 'DELETE') { fileDeletes++; exists = false; return new Response(null, { status: 204 }); }
        if (!exists) return new Response(null, { status: 404 });
        const range = request.headers.get('range');
        const headers = { 'content-type': 'video/mp4', 'content-length': String(range ? 4 : bytes.length) };
        return new Response(request.method === 'HEAD' ? null : range ? bytes.subarray(0, 4) : bytes,
            { status: range ? 206 : 200, headers: { ...headers, ...(range ? { 'content-range': `bytes 0-3/${bytes.length}` } : {}) } });
    } });
try {
    const base = String(await runtime.ready).replace(/\/$/, '');
    const request = (path: string, method = 'GET') => fetch(`${base}${path}`, { method, headers: { origin: base } });
    const stats = await request('/api/stats'); assert.equal(stats.status, 200);
    assert.equal((await stats.json()).overview.videosArchived, 1);
    const range = await fetch(`${base}${videoUrl}`, { headers: { range: 'bytes=0-3' } });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-3/${bytes.length}`);
    const download = await request(`${videoUrl}?download=1`);
    assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition')!, /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await request('/api/stats/videos?cursor=invalid!')).status, 400);
    let deletion = await request('/api/stats/videos/101', 'DELETE'); assert.equal(deletion.status, 200, await deletion.clone().text());
    assert.ok((await deletion.json()).undoUntil > Date.now() + 28_000);
    assert.equal(fileDeletes, 0);
    assert.equal((await request('/api/stats/videos/101/restore', 'POST')).status, 200);
    assert.equal((await (await request('/api/stats/videos')).json()).items.length, 1);
    deletion = await request('/api/stats/videos/101', 'DELETE'); assert.equal(deletion.status, 200);
    await runtime.unsafeEvictDurableObject('slopurself-test', 'ServiceDurableObject', { name: 'global' });
    assert.equal(fileDeletes, 0, 'Soft deletion must not remove the file before the real undo deadline.');
    const timeout = Date.now() + 40_000;
    while (!finalized && Date.now() < timeout) await delay(200);
    assert.equal(finalized, true, 'A real persisted Durable Object alarm must finish deletion without browser activity.');
    assert.equal(fileDeletes, 1);
    assert.equal((await request(videoUrl)).status, 410);
    assert.equal((await request('/api/stats/videos/101/restore', 'POST')).status, 404);
    console.log('PASS: workerd Worker/DO routing, signed S3 ranges/downloads, soft delete/undo and persisted 30-second alarm after object eviction; no real DB, storage or AI calls.');
} finally { await runtime.dispose(); }
