import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestAccount, sessionResponse, profileAuthConfig, verifyAccountToken, type AuthConfig } from '../../src/auth/session';
import { storedProfiles } from '../../src/auth/profiles';
import { HfConnections } from '../../src/auth/huggingface';

const secret = 'identity-test-secret-at-least-thirty-two-characters';
test('a known username and legacy tokens cannot access private APIs; new owners and password proof can', async () => {
    const data = new Map<string, unknown>();
    const profiles = storedProfiles({ get: async <T>(key: string) => data.get(key) as T, put: async (key, value) => { data.set(key, value); } });
    const config: AuthConfig = { AUTH_COOKIE_SECRET: secret };
    const login = (mode: string, password?: string, cookie?: string) => sessionResponse(new Request('https://game.test/api/session', {
        method: 'POST', headers: { origin: 'https://game.test', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ mode, username: 'Alice', password }) }), config, profiles);
    const created = await login('create'); const ownerCookie = created.headers.getSetCookie()[0].split(';')[0];
    const owner = await created.json() as { token: string; account: { id: string } };
    assert.equal((await verifyAccountToken(owner.token, profileAuthConfig(config, profiles))).identityProof, 'owner');
    const attacker = await login('login'); const pending = await attacker.json() as { token: string };
    await assert.rejects(verifyAccountToken(pending.token, profileAuthConfig(config, profiles)));
    await assert.rejects(requestAccount(new Request('https://game.test/api/stats', { headers: { cookie: attacker.headers.getSetCookie()[0].split(';')[0] } }), profileAuthConfig(config, profiles)));
    assert.equal((await (await login('refresh', undefined, ownerCookie)).json() as { identityVerified: boolean }).identityVerified, true);
    config.verifyHfIdentity = async (connection, id) => connection === 'a'.repeat(43) && id === owner.account.id;
    const upgraded = await login('refresh', undefined, `${attacker.headers.getSetCookie()[0].split(';')[0]}; slop_hf=${'a'.repeat(43)}`);
    const body = await upgraded.json() as { token: string; identityVerified: boolean };
    assert.equal(body.identityVerified, true); assert.equal((await verifyAccountToken(body.token, config)).identityProof, 'owner');
});
test('HF binding requires owner proof for first claim and cannot be switched by another HF account', async () => {
    const data = new Map<string, unknown>(), original = globalThis.fetch;
    const hf = new HfConnections({ get: async <T>(key: string) => data.get(key) as T,
        put: async (key, value) => { data.set(key, value); }, delete: async key => data.delete(key) }, { AUTH_COOKIE_SECRET: secret, HF_OAUTH_CLIENT_ID: 'test' });
    let subject = 'hf-alice';
    globalThis.fetch = async input => {
        const u = String(input);
        if (u.endsWith('/oauth/token')) return Response.json({ access_token: 'test-token', token_type: 'Bearer', expires_in: 1000 });
        if (u.endsWith('/oauth/userinfo')) return Response.json({ sub: subject, preferred_username: subject });
        if (u.endsWith('/whoami-v2')) return Response.json({ id: subject, name: subject });
        if (u.endsWith('/zero-gpu/quota')) return Response.json({ current: 300, base: 300, resetsAt: null });
        throw new Error('Unexpected call');
    };
    const connect = async (identityProof: 'owner' | 'pending') => {
        const start = await hf.start({ id: 'alice', name: 'Alice', identityProof, expiresAt: Date.now() + 100_000 }, 'https://game.test');
        return hf.finish(new URL(start.url).searchParams.get('state'), 'code', start.nonce, 'https://game.test');
    };
    try {
        await assert.rejects(connect('pending'), /nicht sicher zugeordnet/);
        const connection = await connect('owner'); assert.equal(await hf.identityMatches(connection.connection, 'alice'), true);
        assert.equal(await hf.identityMatches(connection.connection, 'other'), false);
        await connect('pending'); subject = 'hf-impostor';
        await assert.rejects(connect('pending'), /anderen HF-Konto/);
        await assert.rejects(connect('owner'), /anderen HF-Konto/);
        const restored = data.get('hf-profile-bindings') as Record<string, string>; assert.equal(restored.alice, 'hf-alice');
    } finally { globalThis.fetch = original; }
});
