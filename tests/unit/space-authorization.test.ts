import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalSpaceAuthorization } from '../../src/ai/space-authorization';
import { probePersonalProxy, proxyTransport } from '../../src/ai/personal-proxy';

const token = (expiry: number) => `e30.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.Zml4dHVyZQ`;
test('personal resource authorization is short-lived, Space-scoped and read-only', async t => {
    const expiry = Math.floor(Date.now() / 1000) + 240, jwt = token(expiry);
    t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
        const url = new URL(input);
        assert.equal(url.origin, 'https://huggingface.co');
        assert.equal(url.pathname, '/api/spaces/Manuel2607/SlopUrself-Wan22-Validated/jwt');
        assert.equal(url.searchParams.get('expires_in'), '300'); assert.equal(url.searchParams.get('billing_details'), 'true');
        assert.equal(url.searchParams.has('write'), false); assert.equal(url.searchParams.has('inference_api'), false);
        assert.equal(options.method, undefined); assert.equal(options.redirect, 'manual');
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer own-fixture');
        return Response.json({ token: jwt, accessToken: `Bearer ${jwt}`, exp: expiry });
    });
    assert.equal(await personalSpaceAuthorization('own-fixture'), `Bearer ${jwt}`);
});
test('resource authorization rejects redirects, denied credentials, excessive lifetime and malformed raw tokens', async t => {
    let reply = new Response(null, { status: 302, headers: { location: 'https://untrusted.test/' } });
    t.mock.method(globalThis, 'fetch', async () => reply);
    await assert.rejects(personalSpaceAuthorization('fixture'), /space_access_redirect/);
    reply = Response.json({ secret: 'never-expose-provider-body' }, { status: 403 });
    await assert.rejects(personalSpaceAuthorization('fixture'), /space_access_rejected/);
    for (const expiry of [Math.floor(Date.now() / 1000) - 10, Math.floor(Date.now() / 1000) + 3600]) {
        const jwt = token(expiry); reply = Response.json({ token: jwt, accessToken: `Bearer ${jwt}`, exp: expiry });
        await assert.rejects(personalSpaceAuthorization('fixture'), /space_access_invalid/);
    }
    const expiry = Math.floor(Date.now() / 1000) + 240;
    reply = Response.json({ token: 'invalid', accessToken: `Bearer ${token(expiry)}` });
    await assert.rejects(personalSpaceAuthorization('fixture'), /space_access_invalid/);
    reply = Response.json({ token: token(expiry), accessToken: 'unrelated-legacy-field', exp: expiry });
    assert.equal(await personalSpaceAuthorization('fixture'), `Bearer ${token(expiry)}`);
});
test('experimental read-only resource routes retain the personal application credential and expose no resource secret', async t => {
    const expiry = Math.floor(Date.now() / 1000) + 240, jwt = token(expiry);
    for (const transport of ['space-jwt', 'space-cookie', 'space-signed'] as const) {
        t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
            if (url.startsWith('https://huggingface.co/')) return Response.json({ token: jwt, accessToken: `Bearer ${jwt}`, exp: expiry });
            const endpoint = new URL(url);
            assert.equal(endpoint.origin + endpoint.pathname, 'https://manuel2607-slopurself-wan22-validated.hf.space/identity');
            assert.equal(endpoint.searchParams.get('__sign'), transport === 'space-signed' ? jwt : null);
            const headers = new Headers(options.headers);
            assert.equal(headers.get('authorization'), 'Bearer personal-a');
            assert.equal(headers.get('x-slop-hf-authorization'), 'Bearer personal-a');
            if (transport === 'space-jwt') assert.equal(headers.get('x-hf-authorization'), `Bearer ${jwt}`);
            else if (transport === 'space-cookie') assert.equal(headers.get('cookie'), `__sign=${jwt}`);
            else assert.equal(headers.get('x-hf-authorization'), 'Bearer personal-a');
            return Response.json({ personalIdentityVerified: true, proxySubjectMatches: true, proxyClaimKeys: ['sub'], billingVerified: false, gpuCalls: 0 });
        });
        const result = await probePersonalProxy('personal-a', transport);
        assert.equal(result.credentialRoute, transport); assert.equal(result.billingVerified, false);
        assert.ok(!JSON.stringify(result).includes(jwt));
        t.mock.restoreAll();
    }
    assert.throws(() => proxyTransport('https://untrusted.test/'), /proxy_transport_invalid/);
});
