import assert from 'node:assert/strict';
import { Response } from 'miniflare';
import { cloudflareRuntime } from '../support/cloudflare';

let generations = 0;
let quotaStatus = 200, tokenExchanges = 0;
const runtime = await cloudflareRuntime({ bindings: { AI_PROVIDER: 'wan22', AI_PROVIDER_CHAIN: 'wan22,wan22-fast', AUTH_MODE: '', HF_TOKEN: 'central', HF_OAUTH_CLIENT_ID: 'test-public-client' },
    outboundService: async request => {
        const url = new URL(request.url), token = request.headers.get('authorization')?.replace('Bearer ', '');
        assert.equal(url.hostname, 'huggingface.co');
        if (url.pathname === '/oauth/device') return Response.json({ device_code: 'private-device-code', user_code: 'ABCD-1234', verification_uri: 'https://hf.co/oauth/device', expires_in: 300, interval: 5 });
        if (url.pathname === '/oauth/token') { tokenExchanges++; return Response.json({ access_token: 'personal', token_type: 'Bearer', expires_in: 28800 }); }
        assert.equal(token, 'personal', 'The server token must never be sent to HF.');
        if (url.pathname === '/oauth/userinfo') return Response.json({ sub: 'personal', preferred_username: 'HF_Test' });
        if (url.pathname === '/api/whoami-v2') return Response.json({ id: token, name: token === 'personal' ? 'HF_Test' : 'Central' });
        if (url.pathname === '/api/spaces/zero-gpu/quota') return Response.json({ base: 300, current: token === 'personal' ? 300 : 75, resetsAt: null, runs: { remaining: 8, resetsAt: null } }, { status: quotaStatus });
        generations++; throw new Error('No GPU endpoints permitted in OAuth runtime test');
    } });
try {
    const base = String(await runtime.ready).replace(/\/$/, '');
    const request = async (path: string, method = 'GET', cookie = '', body?: unknown) => {
        // Object eviction may close local keep-alive sockets; use a fresh HTTP connection.
        try { return await fetch(base + path, { method, redirect: 'manual', headers: { origin: base, cookie, connection: 'close', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
        catch (error) { throw new Error(`HF runtime request failed: ${method} ${path.split('?')[0]}`, { cause: error }); }
    };
    const command = async (cookie: string, type: string, payload: object, expected: string) => {
        const upgrade = await runtime.dispatchFetch(`${base}/ws/HF01`, { headers: { upgrade: 'websocket', origin: base, cookie } });
        assert.equal(upgrade.status, 101);
        const socket = upgrade.webSocket!; socket.accept();
        try {
            const result = new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`Missing ${expected} response`)), 5000);
                socket.addEventListener('message', event => {
                    const message = JSON.parse(String(event.data));
                    if (message.type === expected) { clearTimeout(timer); resolve(message.payload); }
                });
            });
            socket.send(JSON.stringify({ type, payload }));
            return await result;
        } finally { socket.close(1000); }
    };
    const metadata = await request('/.well-known/oauth-cimd');
    assert.equal(metadata.status, 200); assert.match(metadata.headers.get('content-type')!, /application\/json/);
    assert.deepEqual((await metadata.json()).redirect_uris, [`${base}/api/hf/callback`]);
    const login = await request('/api/session', 'POST', '', { mode: 'create', username: 'HfRuntime' });
    assert.equal(login.status, 200);
    const auth = login.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await (await request('/api/config', 'GET', auth)).json()).aiRoundLimit, 0);
    assert.match(String(await command(auth, 'createRoom', {}, 'hfRequired')), /Hugging-Face-Konto/);
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
    const other = await request('/api/session', 'POST', '', { mode: 'create', username: 'HfUnlinked' });
    const otherAuth = other.headers.getSetCookie()[0].split(';')[0];
    assert.match(String(await command(`${otherAuth}; ${connection}`, 'createRoom', {}, 'hfRequired')), /Hugging-Face-Konto/);
    await command(cookie, 'createRoom', {}, 'roomCreated');
    assert.match(String(await command(otherAuth, 'joinRoom', {}, 'hfRequired')), /Hugging-Face-Konto/);
    await command(otherAuth, 'joinRoom', { role: 'spectator' }, 'joinedSuccess');
    await runtime.unsafeEvictDurableObject('slopurself-test', 'ServiceDurableObject', { name: 'global' });
    const status = await (await request('/api/hf', 'GET', cookie)).json();
    assert.equal(status.connected, true); assert.equal(status.remainingSeconds, 300);
    assert.equal('token' in status, false);
    assert.equal((await (await request('/api/config', 'GET', cookie)).json()).aiRoundLimit, 3);
    assert.equal((await (await request('/api/hf', 'GET', auth)).json()).connected, false, 'The username alone cannot retrieve its HF connection.');
    assert.equal((await request('/api/hf', 'DELETE', cookie)).status, 200);
    assert.equal((await (await request('/api/hf', 'GET', cookie)).json()).connected, false);
    assert.equal((await request('/api/hf/device', 'POST', '')).status, 401);
    const deviceStart = await request('/api/hf/device', 'POST', auth);
    assert.equal(deviceStart.status, 200);
    const device = await deviceStart.json();
    assert.equal(device.userCode, 'ABCD-1234');
    assert.equal('deviceCode' in device, false); assert.equal('nonce' in device, false);
    const deviceCookie = `${auth}; ${deviceStart.headers.getSetCookie()[0].split(';')[0]}`;
    assert.equal((await (await request('/api/hf/device', 'GET', auth)).json()).pending, false);
    await runtime.unsafeEvictDurableObject('slopurself-test', 'ServiceDurableObject', { name: 'global' });
    assert.equal((await (await request('/api/hf/device', 'GET', deviceCookie)).json()).userCode, 'ABCD-1234');
    await new Promise(resolve => setTimeout(resolve, 5100));
    quotaStatus = 503;
    const held = await request('/api/hf/device-poll', 'POST', deviceCookie);
    assert.equal(held.status, 503); assert.equal((await held.json()).code, 'quota_unavailable');
    const exchanged = tokenExchanges;
    quotaStatus = 200; await new Promise(resolve => setTimeout(resolve, 5100));
    const approved = await request('/api/hf/device-poll', 'POST', deviceCookie);
    assert.deepEqual(await approved.json(), { connected: true });
    assert.equal(tokenExchanges, exchanged, 'Quota recovery must reuse the sealed one-time grant.');
    const deviceConnection = approved.headers.getSetCookie().find(value => value.startsWith('slop_hf='))!.split(';')[0];
    assert.equal((await (await request('/api/hf', 'GET', `${auth}; ${deviceConnection}`)).json()).remainingSeconds, 300);
    assert.equal(generations, 0);
    console.log('PASS: workerd device approval and legacy callback cookies, encrypted DO persistence after eviction, individual quota and disconnect; no GPU usage.');
} finally { await runtime.dispose(); }
