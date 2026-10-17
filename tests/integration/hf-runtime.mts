import assert from 'node:assert/strict';
import { Response } from 'miniflare';
import { cloudflareRuntime } from '../support/cloudflare';

let generations = 0;
const runtime = await cloudflareRuntime({ bindings: { AI_PROVIDER: 'wan22', AI_PROVIDER_CHAIN: 'wan22,wan22-fast', AUTH_MODE: '', HF_TOKEN: 'central', HF_OAUTH_CLIENT_ID: 'test-public-client' },
    outboundService: async request => {
        const url = new URL(request.url), token = request.headers.get('authorization')?.replace('Bearer ', '');
        assert.equal(url.hostname, 'huggingface.co');
        if (url.pathname === '/oauth/token') return Response.json({ access_token: 'personal', token_type: 'Bearer', expires_in: 28800 });
        assert.ok(['personal', 'central'].includes(token || ''));
        if (url.pathname === '/oauth/userinfo') return Response.json({ sub: 'personal', preferred_username: 'HF_Test' });
        if (url.pathname === '/api/whoami-v2') return Response.json({ id: token, name: token === 'personal' ? 'HF_Test' : 'Central' });
        if (url.pathname === '/api/spaces/zero-gpu/quota') return Response.json({ base: 300, current: token === 'personal' ? 300 : 75, resetsAt: null, runs: { remaining: 8 } });
        generations++; throw new Error('No GPU endpoints permitted in OAuth runtime test');
    } });
try {
    const base = String(await runtime.ready).replace(/\/$/, '');
    const request = async (path: string, method = 'GET', cookie = '', body?: unknown) => {
        // Object eviction may close local keep-alive sockets; use a fresh HTTP connection.
        try { return await fetch(base + path, { method, redirect: 'manual', headers: { origin: base, cookie, connection: 'close', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
        catch (error) { throw new Error(`HF runtime request failed: ${method} ${path.split('?')[0]}`, { cause: error }); }
    };
    const metadata = await request('/.well-known/oauth-cimd');
    assert.equal(metadata.status, 200); assert.match(metadata.headers.get('content-type')!, /application\/json/);
    assert.deepEqual((await metadata.json()).redirect_uris, [`${base}/api/hf/callback`]);
    const login = await request('/api/session', 'POST', '', { mode: 'create', username: 'HfRuntime' });
    assert.equal(login.status, 200);
    const auth = login.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await (await request('/api/config', 'GET', auth)).json()).aiRoundLimit, 0);
    const start = await request('/api/hf/connect', 'POST', auth);
    assert.equal(start.status, 200);
    const authorization = new URL((await start.json()).url);
    assert.equal(authorization.searchParams.get('scope'), 'openid profile read-billing');
    const nonce = start.headers.getSetCookie()[0].split(';')[0];
    // Strict account cookies need not accompany the cross-site return; Lax nonce + PKCE binds it.
    const callback = await request(`/api/hf/callback?state=${authorization.searchParams.get('state')}&code=fake-code`, 'GET', nonce);
    assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), '/?hf=connected');
    const connection = callback.headers.getSetCookie().find(value => value.startsWith('slop_hf='))!.split(';')[0];
    const cookie = `${auth}; ${connection}`;
    await runtime.unsafeEvictDurableObject('slopurself-test', 'ServiceDurableObject', { name: 'global' });
    const status = await (await request('/api/hf', 'GET', cookie)).json();
    assert.equal(status.connected, true); assert.equal(status.remainingSeconds, 300);
    assert.equal('token' in status, false);
    assert.equal((await (await request('/api/config', 'GET', cookie)).json()).aiRoundLimit, 3);
    assert.equal((await (await request('/api/hf', 'GET', auth)).json()).connected, false, 'The username alone cannot retrieve its HF connection.');
    assert.equal((await request('/api/hf', 'DELETE', cookie)).status, 200);
    assert.equal((await (await request('/api/hf', 'GET', cookie)).json()).connected, false);
    assert.equal(generations, 0);
    console.log('PASS: workerd OAuth routes, PKCE callback cookies, encrypted DO persistence after eviction, individual quota and disconnect; no GPU usage.');
} finally { await runtime.dispose(); }
