import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContentReports } from '../../src/security/reports';
import { contentReportResponse } from '../../src/server/content-reports';
import { accountsResponse } from '../../src/server/accounts';
import { storedProfiles } from '../../src/auth/profiles';
import { profileAuthConfig, sessionResponse } from '../../src/auth/session';
import worker, { ServiceDurableObject } from '../../src/server/cloudflare/worker';
const url = '/api/videos/videos/1792000000000-abcd-aabbcc.mp4';
function store() {
    const data = new Map<string, unknown>();
    return { get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined, put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } };
}
test('reports deduplicate, bound per-account abuse and preserve bans across reinstantiation and undo metadata', async () => {
    const storage = store(), reports = new ContentReports(storage);
    await Promise.all(Array.from({ length: 10 }, () => reports.report(url, 'viewer', 'other')));
    assert.equal((await reports.list()).length, 1); assert.equal(await reports.blocked(url), false);
    for (let i = 1; i <= 5; i++) await reports.report(url.replace('aabbcc', `aabbcc${i}`), 'viewer', 'other');
    await assert.rejects(reports.report(url.replace('aabbcc', 'aabbcc6'), 'viewer', 'other'), /Meldelimit/);
    await reports.block(url, 'owner'); await storage.put('video-trash', {});
    assert.equal(await new ContentReports(storage).blocked(url), true);
    assert.equal((await reports.list())[0].blocked, true);
    await assert.rejects(reports.block('https://attacker.test/video.mp4', 'owner'));
});
test('report API checks proven identity, origin, viewing rights and independently unlocked administrator', async () => {
    const profiles = storedProfiles(store());
    const config = profileAuthConfig({ AUTH_COOKIE_SECRET: 'reports-test-signing-key-over-thirty-two', ADMIN_ACCESS_KEY: 'reports-independent-admin-key-over-thirty-two' }, profiles);
    const create = async (username: string) => {
        const response = await sessionResponse(new Request('https://game.test/api/session', { method: 'POST', headers: { origin: 'https://game.test' }, body: JSON.stringify({ mode: 'create', username }) }), config, profiles);
        return { cookie: response.headers.getSetCookie()[0].split(';')[0], id: (await response.json() as { account: { id: string } }).account.id };
    };
    const owner = await create('Owner'), viewer = await create('Viewer'); config.ADMIN_ACCOUNT_ID = owner.id;
    const reports = new ContentReports(store()); let canRead = true;
    const request = (path: string, cookie: string, data?: object, origin = 'https://game.test') => new Request(`https://game.test${path}`, { method: data ? 'POST' : 'GET', headers: { cookie, origin }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const handle = (r: Request) => contentReportResponse(r, config, reports, async () => canRead);
    const post = { url, reason: 'other' };
    assert.equal((await handle(request('/api/moderation/reports', '', post))).status, 401);
    assert.equal((await handle(request('/api/moderation/reports', viewer.cookie, post, 'https://evil.test'))).status, 403);
    canRead = false; assert.equal((await handle(request('/api/moderation/reports', viewer.cookie, post))).status, 403);
    canRead = true; assert.equal((await handle(request('/api/moderation/reports', viewer.cookie, post))).status, 200);
    assert.equal((await handle(request('/api/admin/moderation', viewer.cookie))).status, 403);
    assert.equal((await handle(request('/api/admin/moderation/block', owner.cookie, { url, confirmation: url }))).status, 403);
    const unlock = await accountsResponse(request('/api/admin/session', owner.cookie, { key: config.ADMIN_ACCESS_KEY }), config, profiles);
    const cookie = `${owner.cookie}; ${unlock.headers.getSetCookie()[0].split(';')[0]}`;
    assert.equal((await handle(request('/api/admin/moderation/block', cookie, { url, confirmation: 'wrong' }))).status, 409);
    assert.equal((await handle(request('/api/admin/moderation/block', cookie, { url, confirmation: url }))).status, 200);
    assert.equal(await reports.blocked(url), true);
    assert.equal((await (await handle(request('/api/admin/moderation', cookie))).json() as { reports: unknown[] }).reports.length, 1);
});

test('Worker blocks known banned URLs, HEAD, Range and downloads after Services recreation', async () => {
    const storage = store();
    const service = new ServiceDurableObject({ storage } as never, { AI_PROVIDER: 'mock' } as never);
    await service.fetch(new Request('https://internal/security/content/block', { method: 'POST', body: JSON.stringify({ url, accountId: 'owner' }) }));
    const restored = new ServiceDurableObject({ storage } as never, { AI_PROVIDER: 'mock' } as never);
    let assetCalls = 0;
    const env = { AUTH_MODE: 'disabled', AI_PROVIDER: 'mock', ASSETS: { fetch: async () => { assetCalls++; return new Response('must not reach assets'); } },
        SERVICES: { idFromName: () => 'global', get: () => ({ fetch: (request: Request) => restored.fetch(request) }) } };
    for (const request of [new Request(`https://game.test${url}`), new Request(`https://game.test${url}`, { method: 'HEAD' }),
        new Request(`https://game.test${url}`, { headers: { range: 'bytes=0-1' } }), new Request(`https://game.test${url}?download=1`)]) {
        const response = await worker.fetch(request, env as never);
        assert.equal(response.status, 410); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(await response.text(), '');
    }
    assert.equal(assetCalls, 0);
});
