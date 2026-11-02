import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probePersonalProxy, personalProxyFailure } from '../../src/ai/personal-proxy';
const identity = { personalIdentityVerified: true, proxySubjectMatches: true, proxyClaimKeys: ['sub'], billingVerified: false, gpuCalls: 0 };

test('read-only proxy probes keep caller transport and never equate identity with billing', async t => {
    let bound = true;
    t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
        assert.equal(url, 'https://manuel2607-slopurself-wan22-validated.hf.space/identity');
        assert.equal(options.redirect, 'error'); assert.equal(options.method, undefined);
        const headers = new Headers(options.headers);
        for (const name of ['authorization', 'x-hf-authorization', 'x-slop-hf-authorization']) assert.equal(headers.get(name), 'Bearer fixture-personal');
        return Response.json({ ...identity, proxySubjectMatches: bound, unrelatedSecret: 'never-return-this' });
    });
    assert.deepEqual(await probePersonalProxy('fixture-personal'), identity);
    bound = false;
    assert.deepEqual(await probePersonalProxy('fixture-personal'), { ...identity, proxySubjectMatches: false });
});

test('proxy failures expose only finite safe codes, not provider bodies or credentials', async t => {
    let reply = Response.json({ error: 'private-fixture-never-return' }, { status: 403 });
    t.mock.method(globalThis, 'fetch', async () => reply);
    await assert.rejects(probePersonalProxy('fixture'), error => personalProxyFailure(error) === 'producer_http_403');
    reply = Response.json({ error: 'personal_authorization_unavailable' }, { status: 403 });
    await assert.rejects(probePersonalProxy('fixture'), error => personalProxyFailure(error) === 'personal_authorization_unavailable');
    reply = new Response('not JSON', { status: 502 });
    await assert.rejects(probePersonalProxy('fixture'), error => personalProxyFailure(error) === 'producer_http_502');
    for (const malformed of [{ ...identity, gpuCalls: 1 }, { ...identity, billingVerified: true },
        { ...identity, proxyClaimKeys: ['sub=private-value'] }, { ...identity, proxySubjectMatches: 'true' }, null]) {
        reply = Response.json(malformed);
        await assert.rejects(probePersonalProxy('fixture'), error => personalProxyFailure(error) === 'proxy_response_invalid');
    }
    assert.equal(personalProxyFailure(new Error('private-fixture-never-return')), 'validation_unavailable');
});
