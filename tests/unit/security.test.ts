import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeRateLimit, rateKey, httpRateRule, type RateBuckets } from '../../src/security/rate-limit';
import worker, { ServiceDurableObject } from '../../src/server/cloudflare/worker';

test('request limits reset, isolate clients and stay bounded under changing identities', async () => {
    const buckets: RateBuckets = {}, rule = { limit: 2, windowMs: 1000 };
    assert.equal(takeRateLimit(buckets, 'a', rule, 100), 0);
    assert.equal(takeRateLimit(buckets, 'a', rule, 101), 0);
    assert.equal(takeRateLimit(buckets, 'a', rule, 102), 1);
    assert.equal(takeRateLimit(buckets, 'b', rule, 103), 0);
    assert.equal(takeRateLimit(buckets, 'a', rule, 1100), 0);
    for (let i = 0; i < 3000; i++) takeRateLimit(buckets, `client-${i}`, rule, 1101);
    assert.equal(Object.keys(buckets).length, 2048);
    assert.equal(httpRateRule('/assets/video.mp4', 'GET'), undefined);
    assert.equal(httpRateRule('/api/stats/videos', 'GET')?.limit, 120);
    assert.equal(httpRateRule('/api/stats/rooms', 'GET')?.limit, 120);
    const key = await rateKey('127.0.0.1', '/api/session', 'private-salt');
    assert.equal(key.length, 64); assert.equal(key.includes('127.0.0.1'), false);
    assert.notEqual(key, await rateKey('127.0.0.1', '/api/config', 'private-salt'));
});

test('global Worker request limits survive recreation and reject simultaneous bursts', async () => {
    const data = new Map<string, unknown>();
    const state = { storage: { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } } };
    const service = new ServiceDurableObject(state as any, { AI_PROVIDER: 'mock' } as any);
    const request = () => new Request('https://internal/security/rate', { method: 'POST', body: JSON.stringify({ key: 'hashed-client', rule: { limit: 2, windowMs: 60_000 } }) });
    const responses = await Promise.all([service.fetch(request()), service.fetch(request()), service.fetch(request())]);
    const results = await Promise.all(responses.map(r => r.json())) as { retryAfter: number }[];
    assert.deepEqual(results.map(r => Boolean(r.retryAfter)), [false, false, true]);
    const restored = new ServiceDurableObject(state as any, { AI_PROVIDER: 'mock' } as any);
    assert.ok((await (await restored.fetch(request())).json() as any).retryAfter > 0);
});

test('anonymous configuration never reads real quota and blocked requests return Retry-After', async () => {
    let quotaCalls = 0, blocked = false;
    const env = { AI_PROVIDER: 'wan22', AUTH_COOKIE_SECRET: 'test-only-cookie-secret-at-least-32-characters',
        SERVICES: { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
            if (new URL(request.url).pathname.startsWith('/quota/')) quotaCalls++;
            return Response.json({ retryAfter: blocked ? 10 : 0 });
        } }) } };
    const config = await worker.fetch(new Request('https://game.test/api/config'), env as any);
    assert.equal(config.status, 200); assert.equal((await config.json() as any).authEnabled, true); assert.equal(quotaCalls, 0);
    blocked = true;
    const limited = await worker.fetch(new Request('https://game.test/api/config'), env as any);
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '10'); assert.equal(quotaCalls, 0);
});
