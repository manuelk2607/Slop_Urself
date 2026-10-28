import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HfPreflight, readOnlyHfFetch } from '../../src/auth/hf-preflight';

test('HF preflight blocks inference, redirects, other hosts and unexpected methods before sending credentials', async () => {
    let calls = 0;
    const safe = readOnlyHfFetch(async (_request, options) => { calls++; assert.equal(options?.redirect, 'error'); return Response.json({}); });
    for (const url of ['https://huggingface.co/api/jobs', 'https://hf.co/api/whoami-v2', 'https://evil.test/oauth/token',
        'https://huggingface.co/api/whoami-v2?token=private', 'https://huggingface.co/api/whoami-v2#fragment', 'https://user:secret@huggingface.co/oauth/token']) {
        await assert.rejects(safe(url));
    }
    await assert.rejects(safe('https://huggingface.co/oauth/token'));
    await assert.rejects(safe('https://huggingface.co/api/whoami-v2', { method: 'POST' }));
    assert.equal(calls, 0);
    await safe('https://huggingface.co/api/whoami-v2'); assert.equal(calls, 1);
});

function fixture(shared = false, remaining = 300) {
    const original = globalThis.fetch, now = Date.now;
    let time = now(), devices = 0;
    Date.now = () => time;
    const upstream: string[] = [];
    globalThis.fetch = readOnlyHfFetch(async input => {
        const request = new Request(input), url = new URL(request.url); upstream.push(url.pathname);
        if (url.pathname === '/oauth/device') {
            const slot = ++devices;
            return Response.json({ device_code: `fixture-device-${slot}`, user_code: `TEST-000${slot}`, verification_uri: 'https://huggingface.co/oauth/device', interval: 5, expires_in: 300 });
        }
        if (url.pathname === '/oauth/token') {
            const params = new URLSearchParams(await request.text());
            return Response.json({ access_token: `fixture-bearer-${params.get('device_code')!.slice(-1)}`, expires_in: 28800, token_type: 'Bearer' });
        }
        const id = shared ? '1' : request.headers.get('authorization')?.slice(-1);
        if (url.pathname === '/oauth/userinfo') return Response.json({ sub: `hf-${id}`, preferred_username: `Test${id}` });
        if (url.pathname === '/api/whoami-v2') return Response.json({ id: `hf-${id}`, name: `Test${id}` });
        if (url.pathname === '/api/spaces/zero-gpu/quota') return Response.json({ base: 300, current: remaining, resetsAt: null, runs: { remaining: remaining ? 5 : 0 } });
        throw new Error('Unexpected network access');
    });
    const probe = new HfPreflight({ AUTH_COOKIE_SECRET: 'fixture-secret-for-preflight-at-least-32', HF_OAUTH_CLIENT_ID: 'test-public-client' }, 'http://127.0.0.1:3398');
    return { probe, upstream, advance: () => { time += 6000; }, restore: () => { probe.close(); globalThis.fetch = original; Date.now = now; } };
}

test('two-account preflight verifies real code paths but never calls inference or claims billing proof', async () => {
    const f = fixture();
    try {
        await f.probe.start('A'); await f.probe.start('A'); await f.probe.start('B');
        assert.equal(f.upstream.filter(path => path === '/oauth/device').length, 2);
        f.advance(); await f.probe.poll('A'); await f.probe.poll('B');
        const status = JSON.stringify(await f.probe.status());
        assert.doesNotMatch(status, /fixture-bearer|fixture-device|connection|nonce|accountId/);
        const result = await f.probe.check();
        assert.equal(result.distinctAccounts, true); assert.equal(result.foreignCredentialRejected, true);
        assert.equal(result.jobOwnersVerified, true); assert.equal(result.swappedJobRejected, true);
        assert.equal(result.before.A.remaining, 300); assert.equal(result.after.B.remaining, 300);
        assert.equal(result.billingVerified, false); assert.equal(result.liveGenerationCalls, 0); assert.equal(result.generationRelease, false);
        assert.doesNotMatch(JSON.stringify(result), /fixture-bearer|fixture-device|Test1|Test2|hf-1|hf-2/);
        f.probe.close(); await assert.rejects(f.probe.status(), /closed/);
    } finally { f.restore(); }
});

test('shared accounts fail; empty quota does not manufacture job verification', async () => {
    for (const shared of [true, false]) {
        const f = fixture(shared, 0);
        try {
            await f.probe.start('A'); await f.probe.start('B'); f.advance(); await f.probe.poll('A'); await f.probe.poll('B');
            if (shared) await assert.rejects(f.probe.check(), /different HF accounts/);
            else { const result = await f.probe.check(); assert.equal(result.jobOwnersVerified, false); assert.ok(result.localJobCheckSkipped); assert.equal(result.billingVerified, false); }
        } finally { f.restore(); }
    }
});
