import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HfConnections, type HfStorage } from '../../src/auth/huggingface';

test('OAuth exchanges and identity reads reject redirects/oversize bodies without binding a profile or storing a connection', async () => {
    const original = globalThis.fetch;
    try {
        for (const path of ['/oauth/token', '/oauth/userinfo', '/api/whoami-v2', '/oauth/device']) {
            for (const failure of ['redirect', 'oversize'] as const) {
                const data = new Map<string, unknown>();
                const storage: HfStorage = { get: async <T>(key: string) => data.get(key) as T | undefined,
                    put: async (key, value) => { data.set(key, value); }, delete: async key => data.delete(key) };
                const hf = new HfConnections(storage, { AUTH_COOKIE_SECRET: 'boundary-test-secret-at-least-32-characters', HF_OAUTH_CLIENT_ID: 'public-test-client' });
                globalThis.fetch = async (input, options) => {
                    assert.equal(options?.redirect, 'manual');
                    const url = new URL(String(input)); assert.equal(url.origin, 'https://huggingface.co');
                    if (url.pathname === path) return failure === 'redirect'
                        ? new Response(null, { status: 307, headers: { location: 'https://foreign.invalid' } })
                        : Response.json({ padding: 'x'.repeat(70_000) });
                    if (url.pathname === '/oauth/token') return Response.json({ access_token: 'fixture-only', token_type: 'Bearer', expires_in: 60 });
                    if (url.pathname === '/oauth/userinfo') return Response.json({ sub: 'subject', preferred_username: 'Test' });
                    if (url.pathname === '/api/whoami-v2') return Response.json({ id: 'subject', name: 'Test' });
                    throw new Error('No quota or other network request should happen after an invalid identity response');
                };
                const account = { id: 'profile', name: 'Test', identityProof: 'owner' as const, expiresAt: Date.now() + 60_000 };
                if (path === '/oauth/device') await assert.rejects(hf.startDevice(account, 'https://game.test'));
                else {
                    const pending = await hf.start(account, 'https://game.test');
                    await assert.rejects(hf.finish(new URL(pending.url).searchParams.get('state'), 'fixture-code', pending.nonce, 'https://game.test'));
                }
                assert.equal([...data.keys()].some(key => key.startsWith('hf-connection:') || key === 'hf-profile-bindings'), false);
            }
        }
    } finally { globalThis.fetch = original; }
});
