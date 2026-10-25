import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeRateLimit, rateKey, httpRateRule, httpRateScope, payloadBytes, type RateBuckets } from '../../src/security/rate-limit';
import { securityHeaders } from '../../src/security/headers';

test('weighted limits charge actual bytes and reject invalid costs, excessive nesting and binary expansion', () => {
    const buckets: RateBuckets = {}, rule = { limit: 10, windowMs: 1000 };
    assert.equal(takeRateLimit(buckets, 'bytes', rule, 100, 8), 0);
    assert.equal(takeRateLimit(buckets, 'bytes', rule, 101, 3), 1);
    for (const cost of [0, -1, 0.5, NaN, Infinity]) assert.equal(takeRateLimit(buckets, 'bytes', rule, 102, cost), 1);
    assert.equal(takeRateLimit(buckets, 'bytes', rule, 103, 2), 0);
    assert.ok(payloadBytes({ prompt: 'ü😀' }) > payloadBytes({ prompt: 'aa' }));
    assert.throws(() => payloadBytes({ image: 'a'.repeat(12 * 1024 * 1024 + 1) }));
    assert.throws(() => payloadBytes(new Uint8Array(4096)));
    let nested: unknown = {}; for (let i = 0; i < 20; i++) nested = { nested };
    assert.throws(() => payloadBytes(nested));
});
test('CSP permits only this origin and its exact websocket, denies scripts in objects and embedding', () => {
    const headers = securityHeaders('https://game.test');
    assert.match(headers['Content-Security-Policy'], /connect-src 'self' wss:\/\/game.test;/);
    assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
    assert.match(headers['Content-Security-Policy'], /script-src 'self';/);
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.match(securityHeaders('http://127.0.0.1:3310')['Content-Security-Policy'], /ws:\/\/127.0.0.1:3310/);
});
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
    assert.equal(takeRateLimit(buckets, 'unrelated-new-client', rule, 1102), 0);
    assert.equal(httpRateRule('/assets/video.mp4', 'GET'), undefined);
    assert.equal(httpRateRule('/api/stats/videos', 'GET')?.limit, 120);
    assert.equal(httpRateRule('/api/stats/rooms', 'GET')?.limit, 120);
    const key = await rateKey('127.0.0.1', '/api/session', 'private-salt');
    assert.equal(key.length, 64); assert.equal(key.includes('127.0.0.1'), false);
    assert.notEqual(key, await rateKey('127.0.0.1', '/api/config', 'private-salt'));
    assert.equal(httpRateScope('/api/stats/videos/123/restore', 'POST'), httpRateScope('/api/stats/invalid', 'GET'));
    assert.equal(httpRateScope('/api/rooms/ABCD/image', 'GET'), httpRateScope('/api/rooms/EFGH/image', 'GET'));
    assert.notEqual(httpRateScope('/api/hf/device', 'GET'), httpRateScope('/api/hf/device', 'POST'));
});

test('changing invalid URLs cannot bypass a client limit or block unrelated Worker clients', async () => {
    const services = new Map<string, ServiceDurableObject>();
    const env = { AI_PROVIDER: 'wan22', AUTH_COOKIE_SECRET: 'isolated-test-key-at-least-32-characters',
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
        SERVICES: { idFromName: (name: string) => name, get: (name: string) => {
            if (!services.has(name)) {
                const data = new Map<string, unknown>();
                services.set(name, new ServiceDurableObject({ storage: { get: async key => structuredClone(data.get(key)),
                    put: async (key, value) => { data.set(key, structuredClone(value)); } } } as any, { AI_PROVIDER: 'mock' } as any));
            }
            return { fetch: (request: Request) => services.get(name)!.fetch(request) };
        } } };
    const request = (path: string, ip: string) => worker.fetch(new Request(`https://game.test${path}`, { headers: { 'CF-Connecting-IP': ip } }), env as any);
    for (let i = 0; i < 2100; i++) {
        const result = await request(`/api/stats/invalid-${i}`, '192.0.2.10');
        assert.equal(result.status, i < 120 ? 404 : 429);
    }
    assert.equal((await request('/api/stats/another-invalid-url', '192.0.2.20')).status, 404);
    assert.equal((await request('/api/config', '192.0.2.20')).status, 200);
    assert.equal(services.size, 3);
    assert.ok([...services.keys()].every(name => /^rate:[a-f0-9]{64}$/.test(name)));
});

test('public SEO files bypass authentication, rate limiting and static asset failures', async () => {
    let assetCalls = 0, serviceCalls = 0;
    const env = {
        AI_PROVIDER: 'wan22', AUTH_COOKIE_SECRET: 'test-only-cookie-secret-at-least-32-characters',
        ASSETS: { fetch: async () => { assetCalls++; return new Response(null, { status: 503 }); } },
        SERVICES: { idFromName: (name: string) => name, get: () => ({ fetch: async () => { serviceCalls++; return Response.json({ retryAfter: 60 }); } }) }
    };
    const robots = await worker.fetch(new Request('https://game.test/robots.txt', { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), env as any);
    assert.equal(robots.status, 200);
    assert.equal(robots.headers.get('content-type'), 'text/plain');
    assert.equal(robots.headers.has('location'), false);
    assert.equal(robots.headers.has('x-robots-tag'), false);
    const robotsBody = await robots.text();
    assert.match(robotsBody, /^User-agent: \*$/m);
    assert.match(robotsBody, /Sitemap: https:\/\/slopurself\.maki26\.workers\.dev\/sitemap\.xml/);
    const sitemap = await worker.fetch(new Request('https://game.test/sitemap.xml'), env as any);
    assert.equal(sitemap.status, 200);
    assert.equal(sitemap.headers.get('content-type'), 'application/xml');
    assert.match(await sitemap.text(), /<loc>https:\/\/slopurself\.maki26\.workers\.dev\/<\/loc>/);
    const head = await worker.fetch(new Request('https://game.test/robots.txt', { method: 'HEAD' }), env as any);
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(assetCalls, 0); assert.equal(serviceCalls, 0);
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
