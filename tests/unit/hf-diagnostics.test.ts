import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HfOAuthError, hfOAuthMessage, isHfOAuthCode } from '../../src/auth/huggingface';
import { huggingFaceResponse } from '../../src/server/huggingface';
import { sessionResponse } from '../../src/auth/session';
import { storedProfiles } from '../../src/auth/profiles';
import { service } from '../../src/server/cloudflare/runtime';

test('HF error codes survive the DO boundary without exposing arbitrary provider error text', async () => {
    const env = { SERVICES: { idFromName: () => 'global', get: () => ({ fetch: async () => Response.json({ code: 'quota_unavailable', error: 'private-provider-text' }, { status: 503 }) }) } };
    await assert.rejects(service(env as never, '/hf/device/poll'), e => e instanceof HfOAuthError && e.code === 'quota_unavailable' && !e.message.includes('private-provider-text'));
    for (const value of ['__proto__', 'constructor', 'private-token', undefined]) assert.equal(isHfOAuthCode(value), false);
    assert.equal(isHfOAuthCode('quota_unavailable'), true);
});

test('HF HTTP failures expose only controlled explanations and fixed diagnostic fields', async () => {
    const storage = new Map<string, unknown>(), profiles = storedProfiles({ get: async key => storage.get(key) as never,
        put: async (key, value) => { storage.set(key, value); } });
    const config = { AUTH_COOKIE_SECRET: 'test-hf-diagnostics-secret-over-32-characters' }, origin = 'https://game.test';
    const login = await sessionResponse(new Request(origin + '/api/session', { method: 'POST', headers: { origin },
        body: JSON.stringify({ mode: 'create', username: 'HFCheck' }) }), config, profiles);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const old = console.info, logs: string[] = []; console.info = (...args) => { logs.push(args.join(' ')); };
    try {
        for (const error of [new HfOAuthError('quota_unavailable', 'private-token'), new Error('private-provider-text')]) {
            const result = await huggingFaceResponse(new Request(origin + '/api/hf/device-poll', { method: 'POST', headers: { cookie, origin } }), config, async () => { throw error; });
            assert.equal(result.status, 503); const body = await result.text();
            assert.ok(!body.includes('private-'));
            if (error instanceof HfOAuthError) assert.equal(JSON.parse(body).error, hfOAuthMessage(error.code));
        }
        assert.ok(!logs.join().includes('private-'));
        assert.deepEqual(logs.map(line => JSON.parse(line)), [
            { type: 'hf_connection_failed', stage: 'device_poll', code: 'quota_unavailable' },
            { type: 'hf_connection_failed', stage: 'device_poll', code: 'unclassified' }
        ]);
    } finally { console.info = old; }
});
