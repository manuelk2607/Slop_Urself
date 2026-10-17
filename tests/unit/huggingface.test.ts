import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HfConnections, HfOAuthError, hfCookie, hfClient, type HfStorage } from '../../src/auth/huggingface';
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
    let nextToken = '', exchanges = 0, quotaStatus = 200;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
        const url = String(input), token = new Headers(options?.headers).get('authorization')?.replace('Bearer ', '') || '';
        if (url.endsWith('/oauth/token')) { exchanges++; return Response.json({ access_token: nextToken, token_type: 'Bearer', expires_in: 28800 }); }
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
        const account = { id: accountId, name: accountId, expiresAt: Date.now() + 60_000 };
        const start = await connections.start(account, 'https://game.test');
        const state = new URL(start.url).searchParams.get('state');
        const result = await connections.finish(state, 'test-code', start.nonce, 'https://game.test');
        return { id: accountId, accountId, hfConnectionId: result.connection };
    }
    return { storage, data, config, connections, tokens, seconds, connect, exchanges: () => exchanges,
        setQuotaStatus(value: number) { quotaStatus = value; }, restore() { globalThis.fetch = original; } };
}

test('HF OAuth uses PKCE, minimal scopes and one-time browser-bound state; secrets stay encrypted', async () => {
    const f = fixture();
    try {
        const account = { id: 'a', name: 'a', expiresAt: Date.now() + 60_000 };
        const start = await f.connections.start(account, 'https://game.test'), url = new URL(start.url);
        assert.equal(url.origin, 'https://huggingface.co');
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
        assert.equal((await budget.capacity(2, 'economy')).aiRoundLimit, 1);
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

test('same HF identity is deduplicated across profiles and the central account, while a weak player limits the room', async () => {
    const f = fixture();
    try {
        const a = await f.connect('a', 'same'), b = await f.connect('b', 'same');
        const budget = new PlayerQuotaBudget(f.storage, f.config, f.connections);
        assert.equal((await budget.capacity(2, 'economy', [a, b])).aiRoundLimit, 1);
        const self = await f.connect('self-profile', 'self', 'owner');
        assert.equal((await budget.capacity(2, 'economy', [self, { id: 'central-player' }])).aiRoundLimit, 1);
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

test('snapshots never publish HF credentials and remaining rounds are computed per creator', () => {
    const room = { code: 'AAAA', hostId: 'a', players: [
        { id: 'a', name: 'a', score: 0, connected: true, sessionId: 'secret', hfConnectionId: 'private-capability' },
        { id: 'b', name: 'b', score: 0, connected: true, sessionId: 'secret2' }
    ], state: 'IDLE', activeCreatorIndex: 1, currentVotes: {}, currentPrompt: '', currentVideoUrl: '', currentRound: 1, maxRounds: 3,
        roundPlayers: ['a', 'b'], pendingCreators: ['b'] } as Room;
    assert.equal(remainingVideosFor(room, 'a'), 2); assert.equal(remainingVideosFor(room, 'b'), 3);
    assert.ok(!JSON.stringify(roomSnapshot(room, 'b')).includes('private-capability'));
});
