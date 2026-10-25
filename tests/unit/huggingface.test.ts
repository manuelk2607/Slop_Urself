import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HfConnections, HfOAuthError, HfRequiredError, hfCookie, hfClient, type HfStorage } from '../../src/auth/huggingface';
import { PlayerQuotaBudget } from '../../src/ai/player-quota';
import { huggingFaceResponse } from '../../src/server/huggingface';
import { sessionResponse } from '../../src/auth/session';
import { storedProfiles } from '../../src/auth/profiles';
import { ServiceDurableObject } from '../../src/server/cloudflare/services';
import { roomSnapshot, remainingVideosFor, type Room } from '../../src/game/rules';

function fixture() {
    const data = new Map<string, any>();
    const storage: HfStorage = { get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); }, delete: async key => data.delete(key) };
    const config = { AUTH_COOKIE_SECRET: 'test-signing-key-with-at-least-32-characters', HF_OAUTH_CLIENT_ID: 'public-test-client',
        HF_TOKEN: 'central', AI_PROVIDER: 'wan22', AI_PROVIDER_CHAIN: 'wan22,wan22-fast', AI_IMAGE_PROFILE: 'bounded' as const };
    const tokens: Record<string, { id: string; name: string }> = { central: { id: 'self', name: 'owner' } };
    const seconds: Record<string, number> = { self: 300 };
    let nextToken = '', exchanges = 0, quotaStatus = 200, devicePolls = 0, deviceError = 'authorization_pending', deviceUsed = false;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
        const url = String(input), token = new Headers(options?.headers).get('authorization')?.replace('Bearer ', '') || '';
        if (url.endsWith('/oauth/device')) { deviceUsed = false; return Response.json({ device_code: 'secret-device-code', user_code: 'ABCD-1234', verification_uri: 'https://hf.co/oauth/device', expires_in: 300, interval: 5 }); }
        if (url.endsWith('/oauth/token')) {
            const body = new URLSearchParams(String(options?.body));
            if (body.has('device_code')) {
                devicePolls++; assert.equal(body.get('device_code'), 'secret-device-code');
                if (deviceError) return Response.json({ error: deviceError }, { status: 400 });
                if (deviceUsed) return Response.json({ error: 'invalid_grant' }, { status: 400 });
                deviceUsed = true;
            }
            exchanges++; return Response.json({ access_token: nextToken, token_type: 'Bearer', expires_in: 28800 });
        }
        const user = tokens[token];
        if (!user) return new Response(null, { status: 401 });
        if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: user.id, preferred_username: user.name });
        if (url.endsWith('/api/whoami-v2')) return Response.json(user);
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: seconds[user.id], resetsAt: null, runs: { remaining: 8 } }, { status: quotaStatus });
        throw new Error('Unexpected external request in isolated HF test');
    };
    const connections = new HfConnections(storage, config);
    async function connect(accountId: string, subject: string, name = subject) {
        nextToken = `private-access-${accountId}-${subject}`;
        tokens[nextToken] = { id: subject, name }; seconds[subject] ??= 300;
        const account = { id: accountId, name: accountId, identityProof: 'owner' as const, expiresAt: Date.now() + 60_000 };
        const start = await connections.start(account, 'https://game.test');
        const state = new URL(start.url).searchParams.get('state');
        const result = await connections.finish(state, 'test-code', start.nonce, 'https://game.test');
        return { id: accountId, accountId, hfConnectionId: result.connection };
    }
    return { storage, data, config, connections, tokens, seconds, connect, exchanges: () => exchanges,
        devicePolls: () => devicePolls, deviceError(value: string) { deviceError = value; },
        setQuotaStatus(value: number) { quotaStatus = value; }, restore() { globalThis.fetch = original; } };
}

test('HF OAuth uses PKCE, minimal scopes and one-time browser-bound state; secrets stay encrypted', async () => {
    const f = fixture();
    try {
        const account = { id: 'a', name: 'a', identityProof: 'owner' as const, expiresAt: Date.now() + 60_000 };
        const start = await f.connections.start(account, 'https://game.test'), url = new URL(start.url);
        assert.equal(url.origin, 'https://huggingface.co');
        assert.match(start.url, /scope=openid%20profile%20read-billing/);
        assert.doesNotMatch(start.url, /scope=openid\+profile/);
        assert.equal(url.searchParams.get('scope'), 'openid profile read-billing');
        assert.equal(url.searchParams.get('prompt'), 'consent');
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.match(url.searchParams.get('code_challenge')!, /^[A-Za-z0-9_-]{43}$/);
        await assert.rejects(f.connections.finish(url.searchParams.get('state'), 'code', 'wrong-browser', 'https://game.test'));
        assert.equal(f.exchanges(), 0);
        const player = await f.connect('a', 'hf-a');
        assert.equal((await f.connections.credential(player.hfConnectionId, 'a')).subject, 'hf-a');
        assert.ok(!JSON.stringify([...f.data.values()]).includes('private-access-'));
        await assert.rejects(f.connections.credential(player.hfConnectionId, 'someone-else'));
        const wrongKey = new HfConnections(f.storage, { AUTH_COOKIE_SECRET: 'different-encryption-key-more-than-32-characters' });
        await assert.rejects(wrongKey.credential(player.hfConnectionId, 'a'));
        assert.throws(() => hfClient('http://127.0.0.1:3000', {}));
        assert.equal(hfClient('https://game.test', {}), 'https://game.test/.well-known/oauth-cimd');
        const pending = await f.connections.start(account, 'https://game.test');
        const pendingState = new URL(pending.url).searchParams.get('state');
        await f.connections.finish(pendingState, 'code', pending.nonce, 'https://game.test');
        const count = f.exchanges();
        await assert.rejects(f.connections.finish(pendingState, 'code', pending.nonce, 'https://game.test'));
        assert.equal(f.exchanges(), count, 'A replay cannot exchange another authorization code.');
    } finally { f.restore(); }
});

test('HF device approval survives reload, throttles provider polling, binds the browser and profile, and encrypts credentials', async () => {
    const f = fixture(), originalNow = Date.now;
    let now = originalNow(); Date.now = () => now;
    try {
        await f.connect('a', 'hf-a');
        const account = { id: 'a', name: 'a', identityProof: 'owner' as const, expiresAt: now + 60_000 }, origin = 'https://game.test';
        const start = await f.connections.startDevice(account, origin);
        assert.equal(start.userCode, 'ABCD-1234');
        assert.equal(JSON.stringify([...f.data.values()]).includes('secret-device-code'), false);
        assert.equal((await f.connections.deviceStatus(start.nonce, 'b', origin)).pending, false);
        assert.equal((await f.connections.pollDevice('wrong-browser', account, origin)).connected, undefined);
        assert.equal((await f.connections.pollDevice(start.nonce, account, origin)).pending, true);
        assert.equal(f.devicePolls(), 0);
        const resumed = new HfConnections(f.storage, f.config);
        assert.equal((await resumed.deviceStatus(start.nonce, 'a', origin)).pending, true);
        now += 5000;
        assert.equal((await resumed.pollDevice(start.nonce, account, origin)).pending, true);
        assert.equal(f.devicePolls(), 1);
        f.deviceError('slow_down'); now += 5000;
        assert.equal((await resumed.pollDevice(start.nonce, account, origin)).retryAfter, 10);
        now += 5000;
        await resumed.pollDevice(start.nonce, account, origin);
        assert.equal(f.devicePolls(), 2);
        f.deviceError(''); now += 5000;
        const completed = await resumed.pollDevice(start.nonce, account, origin);
        assert.equal(completed.connected, true);
        assert.equal((await resumed.credential(completed.connection, 'a')).username, 'hf-a');
        assert.deepEqual(await resumed.pollDevice(start.nonce, account, origin), completed, 'A lost browser response must not exchange or create another token.');
        assert.equal(f.devicePolls(), 3);
        await resumed.cancelDevice(start.nonce, 'a', origin);
        assert.equal((await resumed.deviceStatus(start.nonce, 'a', origin)).pending, false);
        for (const code of ['access_denied', 'expired_token', 'invalid_grant']) {
            const next = await resumed.startDevice(account, origin); now += 5000; f.deviceError(code);
            assert.ok((await resumed.pollDevice(next.nonce, account, origin)).error);
            assert.equal((await resumed.deviceStatus(next.nonce, 'a', origin)).pending, false);
        }
        const expired = await resumed.startDevice(account, origin); now += 301_000;
        assert.ok((await resumed.pollDevice(expired.nonce, account, origin)).error);
    } finally { Date.now = originalNow; f.restore(); }
});

test('device grants survive a temporary quota outage and recreation without exchanging twice or extending token lifetime', async () => {
    const f = fixture(), originalNow = Date.now;
    let now = originalNow(); Date.now = () => now;
    try {
        await f.connect('a', 'hf-a');
        const account = { id: 'a', name: 'a', identityProof: 'owner' as const, expiresAt: now + 60_000 }, origin = 'https://game.test';
        const start = await f.connections.startDevice(account, origin);
        f.deviceError(''); f.setQuotaStatus(503); now += 5000;
        const receivedAt = now, exchanges = f.exchanges();
        await assert.rejects(f.connections.pollDevice(start.nonce, account, origin), error => error instanceof HfOAuthError && error.code === 'quota_unavailable');
        assert.equal(f.exchanges(), exchanges + 1);
        assert.equal(JSON.stringify([...f.data.values()]).includes('private-access-'), false);
        f.setQuotaStatus(200); now += 10_000;
        const resumed = new HfConnections(f.storage, f.config);
        const [first, second] = await Promise.all([resumed.pollDevice(start.nonce, account, origin), resumed.pollDevice(start.nonce, account, origin)]);
        assert.equal(first.connected, true); assert.deepEqual(second, first);
        assert.equal(first.expiresAt, receivedAt + 8 * 60 * 60_000);
        assert.equal(f.exchanges(), exchanges + 1); assert.equal(f.devicePolls(), 1);
        assert.equal((await resumed.credential(first.connection, 'a')).username, 'hf-a');
    } finally { Date.now = originalNow; f.restore(); }
});

test('concurrent vault writes preserve the expiry index and callback/device operations remain single-use', async () => {
    const f = fixture();
    try {
        const account = { id: 'a', name: 'a', identityProof: 'owner' as const, expiresAt: Date.now() + 60_000 }, origin = 'https://game.test';
        await Promise.all(Array.from({ length: 20 }, () => f.connections.start(account, origin)));
        assert.equal(Object.keys(f.data.get('hf-expiries')).length, 20);
        const start = await f.connections.start(account, origin), state = new URL(start.url).searchParams.get('state');
        await f.connect('a', 'hf-a');
        const before = f.exchanges();
        const result = await Promise.allSettled([f.connections.finish(state, 'code', start.nonce, origin), f.connections.finish(state, 'code', start.nonce, origin)]);
        assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(f.exchanges(), before + 1);
        assert.deepEqual(Object.keys(f.data.get('hf-expiries')).sort(), [...f.data.keys()].filter(key => key !== 'hf-expiries' && key !== 'hf-profile-bindings').sort());
    } finally { f.restore(); }
});

test('personal budgets never query the server token and retain pre-migration holds for their known owner', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'hf-a'), b = await f.connect('b', 'hf-b'), self = await f.connect('self-profile', 'self', 'owner');
        const original = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            assert.notEqual(new Headers(init?.headers).get('authorization'), 'Bearer central');
            return original(url, init);
        };
        let budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        assert.equal((await budget.capacity(2, 'economy', [a, b])).aiRoundLimit, 3);
        await budget.reserve('AAAA', 2, 2, 'economy', [a, b]);
        assert.equal((await budget.capacity(2, 'economy', [a, b])).aiRoundLimit, 1);
        assert.equal((await budget.capacity(2, 'economy', [a, { id: 'central-player' }])).aiRoundLimit, 0);
        await budget.release('AAAA');
        budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        await f.storage.put('central-identity', { subject: 'self' });
        await f.storage.put('reservations', { HOLD: { rounds: 2, active: 0, expiresAt: Date.now() + 60_000, reset: null, gpuSecondsPerVideo: 79 } });
        delete f.tokens.central;
        budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        assert.equal((await budget.capacity(1, 'economy', [self])).aiRoundLimit, 1);
    } finally { f.restore(); }
});

test('slow HF status and capacity reads do not block another account or atomic quota releases', async () => {
    const f = fixture();
    let unblock: (() => void) | undefined;
    try {
        const a = await f.connect('a', 'hf-a'), b = await f.connect('b', 'hf-b');
        const original = globalThis.fetch;
        const service = new ServiceDurableObject({ storage: f.storage } as any, f.config as any);
        const post = (path: string, body: object) => service.fetch(new Request(`https://internal${path}`, { method: 'POST', body: JSON.stringify(body) }));
        for (const path of ['/hf/status', '/quota/capacity']) {
            let started!: () => void;
            const startedRequest = new Promise<void>(resolve => { started = resolve; });
            const gate = new Promise<void>(resolve => { unblock = resolve; });
            globalThis.fetch = async (url, init) => {
                if (String(url).endsWith('/zero-gpu/quota') && new Headers(init?.headers).get('authorization') === 'Bearer private-access-a-hf-a') { started(); await gate; }
                return original(url, init);
            };
            const slow = post(path, { connection: a.hfConnectionId, accountId: a.accountId, players: 1, participants: [a] });
            await startedRequest;
            try {
                const independent = Promise.all([post('/quota/release', { code: 'TEST' }), post('/hf/status', { connection: b.hfConnectionId, accountId: b.accountId })]);
                const result = await Promise.race([independent, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Unrelated operations were blocked.')), 1000))]);
                assert.deepEqual(result.map(response => response.status), [200, 200]);
                assert.equal((await result[1].json() as any).connected, true);
            } finally { unblock(); await slow; }
        }
    } finally { unblock?.(); f.restore(); }
});

test('concurrent cleanup scheduling keeps the earliest video or HF deadline', async () => {
    let alarm: number | null = null;
    const service = new ServiceDurableObject({ storage: {
        getAlarm: async () => { const current = alarm; await new Promise(resolve => setImmediate(resolve)); return current; },
        setAlarm: async (time: number) => { await new Promise(resolve => setImmediate(resolve)); alarm = time; }
    } } as any, { AI_PROVIDER: 'mock' } as any);
    const schedule = (time: number) => (service as any).scheduleCleanup(time) as Promise<void>;
    await Promise.all([schedule(100), schedule(500), schedule(200)]);
    assert.equal(alarm, 100);
    await Promise.all([schedule(50), schedule(300)]);
    assert.equal(alarm, 50);
});

test('HF connection is not saved when OAuth cannot read ZeroGPU quota, and expired secrets are purged', async () => {
    const f = fixture();
    try {
        f.setQuotaStatus(403);
        await assert.rejects(f.connect('a', 'hf-a'), error => error instanceof HfOAuthError && error.code === 'quota_forbidden');
        assert.equal([...f.data.keys()].some(key => key.startsWith('hf-connection:')), false);
        f.setQuotaStatus(503);
        await assert.rejects(f.connect('a', 'hf-a'), error => error instanceof HfOAuthError && error.code === 'quota_unavailable');
        f.setQuotaStatus(200);
        const player = await f.connect('a', 'hf-a');
        const status = await f.connections.status(player.hfConnectionId, 'a');
        assert.equal(status.connected, true); assert.equal(status.remainingSeconds, 300);
        assert.equal('token' in status, false); assert.equal('subject' in status, false);
        const key = `hf-connection:${player.hfConnectionId}`;
        f.data.get(key).expiresAt = Date.now() - 1;
        const expiries = f.data.get('hf-expiries'); expiries[key] = Date.now() - 1;
        await f.connections.cleanup(); assert.equal(f.data.has(key), false);
    } finally { f.restore(); }
});

test('HF HTTP endpoints enforce origin, use Lax state cookies and never expose connection capabilities in account JSON', async () => {
    const f = fixture();
    try {
        const profile = storedProfiles(f.storage), origin = 'https://game.test';
        const login = await sessionResponse(new Request(`${origin}/api/session`, { method: 'POST', headers: { origin }, body: JSON.stringify({ mode: 'create', username: 'test' }) }), f.config, profile);
        const auth = login.headers.getSetCookie()[0].split(';')[0];
        const service = async (path: string, data: Record<string, any>) => {
            if (path === '/hf/start') return f.connections.start(data.account, data.origin);
            if (path === '/hf/finish') return f.connections.finish(data.state, data.code, data.nonce, data.origin);
            if (path === '/hf/status') return f.connections.status(data.connection, data.accountId);
            if (path === '/hf/disconnect') { await f.connections.disconnect(data.connection, data.accountId); return {}; }
            throw new Error('Unexpected path');
        };
        const handle = (path: string, method = 'GET', cookie = auth, requestOrigin = origin) => huggingFaceResponse(new Request(origin + path,
            { method, headers: { cookie, origin: requestOrigin } }), f.config, service);
        assert.equal((await handle('/api/hf/connect', 'POST', auth, 'https://other.test')).status, 403);
        assert.equal((await handle('/api/hf', 'GET', '')).status, 401);
        const start = await handle('/api/hf/connect', 'POST');
        assert.match(start.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax;.*Secure/);
        const nonceCookie = start.headers.getSetCookie()[0].split(';')[0];
        const url = new URL((await start.json()).url);
        assert.match(url.href, /scope=openid%20profile%20read-billing/);
        assert.equal(url.searchParams.get('prompt'), 'consent');
        const player = await f.connect('not-this-account', 'hf-a'); // Prepare the fake token response.
        const callback = await handle(`/api/hf/callback?state=${url.searchParams.get('state')}&code=callback-code`, 'GET', nonceCookie);
        assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), '/?hf=connected');
        assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
        const connectionCookie = callback.headers.getSetCookie().find(value => value.startsWith('slop_hf='))!.split(';')[0];
        const session = await sessionResponse(new Request(`${origin}/api/session`, { headers: { cookie: `${auth}; ${connectionCookie}` } }), f.config, profile);
        const result = await session.json(); assert.equal('hfConnectionId' in result.account, false);
        assert.equal(hfCookie(new Request(origin, { headers: { cookie: connectionCookie } }))?.length, 43);
        assert.equal((await handle('/api/hf/callback?state=bad&code=bad', 'GET', nonceCookie)).headers.get('location'), '/?hf=failed');
        assert.ok(player.hfConnectionId);
    } finally { f.restore(); }
});

test('individual quotas give each player three rounds, not one shared round or six pooled rounds', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'hf-a'), b = await f.connect('b', 'hf-b');
        const budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        assert.equal((await budget.capacity(2, 'economy')).aiRoundLimit, 0);
        const capacity = await budget.capacity(2, 'economy', [a, b]);
        assert.equal(capacity.aiRoundLimit, 3); assert.equal(capacity.sharedQuota, false);
        await budget.reserve('AAAA', 3, 2, 'economy', [a, b]);
        assert.equal((await budget.capacity(2, 'economy', [a, b])).aiRoundLimit, 0);
        await assert.rejects(budget.reserve('BBBB', 1, 2, 'economy', [a, b]));
        await budget.begin('AAAA', 6, 'job-a', a.id, 3, a);
        await budget.allowAttempt('AAAA', 126, 'job-a');
        await assert.rejects(budget.begin('AAAA', 6, 'job-a2', a.id, 3, a));
        await f.connections.disconnect(a.hfConnectionId, a.accountId);
        assert.match((await budget.tokenForJob('AAAA', 'job-a'))!, /private-access-a/);
        await assert.rejects(budget.begin('AAAA', 6, 'job-impostor', a.id, 3, { id: a.id, accountId: a.accountId }));
        await budget.consume('AAAA', 'job-a'); await budget.consume('AAAA', 'job-a');
        assert.equal(f.data.has('hf-job:job-a'), false);
        await budget.drop('AAAA', 2, a.id);
        await budget.begin('AAAA', 3, 'job-b', b.id, 3, b);
        await budget.release('AAAA');
        const held = f.data.get('hf-budget:hf-b:reservations')['AAAA:b'];
        assert.equal(held.rounds, 1); assert.equal(held.active, 1);
        await budget.consume('AAAA', 'job-b');
    } finally { f.restore(); }
});

test('the same HF identity is deduplicated across profiles and a missing or weak personal account limits the room', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'same'), b = await f.connect('b', 'same');
        const budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        assert.equal((await budget.capacity(2, 'economy', [a, b])).aiRoundLimit, 1);
        const self = await f.connect('self-profile', 'self', 'owner');
        assert.equal((await budget.capacity(2, 'economy', [self, { id: 'central-player' }])).aiRoundLimit, 0);
        f.seconds.same = 70;
        assert.equal((await budget.capacity(2, 'economy', [a, self])).aiRoundLimit, 0);
        assert.equal((await budget.capacity(1, 'economy', [{ ...a, accountId: 'impostor' }])).aiRoundLimit, 0);
    } finally { f.restore(); }
});

test('personal reservations survive service recreation and serialize simultaneous rooms', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'hf-a'), b = await f.connect('b', 'hf-b');
        const state = { storage: { ...f.storage, getAlarm: async () => null, setAlarm: async () => {} } } as any;
        const env = f.config as any;
        let service = new ServiceDurableObject(state, env);
        const request = (path: string, data: object) => service.fetch(new Request(`https://internal${path}`, { method: 'POST', body: JSON.stringify(data) }));
        const results = await Promise.all(['AAAA', 'BBBB'].map(code => request('/quota/reserve', { code, rounds: 2, players: 2, quality: 'economy', participants: [a, b] })));
        assert.deepEqual(results.map(r => r.status).sort(), [200, 503]);
        service = new ServiceDurableObject(state, env);
        const capacity = await (await request('/quota/capacity', { players: 2, quality: 'economy', participants: [a, b] })).json();
        assert.equal(capacity.aiRoundLimit, 1);
    } finally { f.restore(); }
});

test('missing, expired, foreign and unbound credentials fail closed even with a configured server token', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'hf-a');
        globalThis.fetch = async () => { throw new Error('No provider request allowed'); };
        const budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        assert.equal((await budget.displayCapacity()).aiRoundLimit, 0);
        assert.equal((await budget.capacity(1, 'auto', [{ id: 'a' }])).aiRoundLimit, 0);
        await assert.rejects(budget.reserve('NONE', 1));
        await assert.rejects(budget.extend('NONE', 1));
        await assert.rejects(budget.begin('NONE', 1, 'unknown', 'a', 1, a));
        await assert.rejects(budget.tokenForJob('NONE', 'unknown'));
        await assert.rejects(budget.allowAttempt('NONE', 79, 'unknown'));
        assert.equal((await budget.capacity(1, 'auto', [{ ...a, accountId: 'other' }])).aiRoundLimit, 0);
        const sealed = f.data.get(`hf-connection:${a.hfConnectionId}`);
        sealed.expiresAt = Date.now() - 1;
        await assert.rejects(f.connections.credential(a.hfConnectionId, a.accountId));
    } finally { f.restore(); }
});

test('a pinned job token must match its reserved player and HF identity', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'hf-a'), b = await f.connect('b', 'hf-b');
        const budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        await budget.reserve('TEST', 1, 2, 'economy', [a, b]);
        await budget.begin('TEST', 2, 'owned-job', a.id, 1, a);
        await f.connections.pinJob(b.hfConnectionId, b.accountId, 'owned-job');
        await assert.rejects(budget.tokenForJob('TEST', 'owned-job'));
    } finally { f.restore(); }
});

test('a revoked HF token requests reconnection before any new video can start', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'hf-a');
        const budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        await budget.reserve('TEST', 1, 1, 'economy', [a]);
        f.setQuotaStatus(401);
        await assert.rejects(budget.begin('TEST', 1, 'revoked-job', a.id, 1, a), HfRequiredError);
        assert.equal(f.data.has('hf-job:revoked-job'), false);
        assert.deepEqual(f.data.get('quota-plan:TEST').jobs, {});
    } finally { f.restore(); }
});

test('snapshots never publish HF credentials and remaining rounds are computed per creator', () => {
    const room = { code: 'AAAA', hostId: 'a', players: [
        { id: 'a', name: 'a', score: 0, connected: true, sessionId: 'secret', hfConnectionId: 'private-capability' },
        { id: 'b', name: 'b', score: 0, connected: true, sessionId: 'secret2' }
    ], state: 'IDLE', activeCreatorIndex: 1, currentVotes: {}, currentPrompt: '', currentVideoUrl: '', currentRound: 1, maxRounds: 3,
        roundPlayers: ['a', 'b'], pendingCreators: ['b'] } as Room;
    assert.equal(remainingVideosFor(room, 'a'), 2); assert.equal(remainingVideosFor(room, 'b'), 3);
    assert.ok(!JSON.stringify(roomSnapshot(room, 'b')).includes('private-capability'));
});
