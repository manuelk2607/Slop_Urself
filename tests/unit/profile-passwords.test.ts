import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storedProfiles } from '../../src/auth/profiles';
import { hashPassword, checkPassword } from '../../src/auth/passwords';
import { sessionResponse, profileAuthConfig, verifyAccountToken } from '../../src/auth/session';
import { accountsResponse } from '../../src/server/accounts';

const secret = 'password-test-cookie-secret-at-least-32-characters';
async function fixture() {
    const data = new Map<string, unknown>();
    const profiles = storedProfiles({ get: async <T>(key: string) => data.get(key) as T, put: async (key, value) => { data.set(key, value); } });
    const owner = (await profiles.create('Owner'))!;
    const config = { AUTH_COOKIE_SECRET: secret, ADMIN_ACCOUNT_ID: owner.id, ADMIN_ACCESS_KEY: 'separate-admin-secret-at-least-32-characters' };
    const login = (username: string, password?: string, mode = 'login') => sessionResponse(new Request('https://game.test/api/session', {
        method: 'POST', headers: { origin: 'https://game.test' }, body: JSON.stringify({ username, password, mode }) }), config, profiles);
    return { profiles, owner, config, login };
}
test('PBKDF2 has unique 16-byte salts, exactly 100000 iterations and rejects malformed hashes', async () => {
    const a = await hashPassword('a sufficiently long password'), b = await hashPassword('a sufficiently long password');
    assert.match(a, /^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/); assert.notEqual(a, b);
    assert.equal(await checkPassword('a sufficiently long password', a), true);
    assert.equal(await checkPassword('a different long password', a), false);
    assert.equal(await checkPassword('a sufficiently long password', 'broken'), false);
    await assert.rejects(hashPassword('short')); await assert.rejects(hashPassword('x'.repeat(201)));
});
test('open profiles remain username-only; protected registrations require passwords and never expose hashes', async () => {
    const f = await fixture();
    assert.equal((await f.login('New', 'short', 'create')).status, 422);
    const created = await f.login('New', 'long-enough-password', 'create'); assert.equal(created.status, 200);
    assert.doesNotMatch(await created.text(), /passwordHash|password_hash|pbkdf2|long-enough-password/);
    assert.equal((await f.login('Owner')).status, 200);
    const required = await f.login('New'); assert.equal(required.status, 401); assert.equal((await required.json() as any).code, 'password_required');
    assert.equal((await f.login('New', 'wrong-long-password')).status, 401);
    assert.equal((await f.login('New', 'long-enough-password')).status, 200);
});
test('password resets require separately unlocked owner, exact confirmation and revoke old HTTP/WS JWTs', async () => {
    const f = await fixture(), friend = (await f.profiles.create('Friend'))!;
    const session = await f.login('Owner'), cookie = session.headers.get('set-cookie')!.split(';')[0];
    const old = await (await f.login('Friend')).json() as any;
    const handle = (path: string, body: unknown, auth = cookie) => accountsResponse(new Request(`https://game.test${path}`, { method: 'POST', headers: { origin: 'https://game.test', cookie: auth }, body: JSON.stringify(body) }), f.config, f.profiles);
    const path = `/api/admin/accounts/${friend.id}/password`, body = { confirmation: friend.name, password: 'replacement-password' };
    assert.equal((await handle(path, body)).status, 403);
    const unlocked = await handle('/api/admin/session', { key: f.config.ADMIN_ACCESS_KEY });
    const admin = `${cookie}; ${unlocked.headers.get('set-cookie')!.split(';')[0]}`;
    assert.equal((await handle(path, { ...body, confirmation: 'friend' }, admin)).status, 409);
    assert.equal((await handle(path, body, admin)).status, 200);
    await assert.rejects(verifyAccountToken(old.token, profileAuthConfig(f.config, f.profiles)));
    assert.equal((await f.login('Friend')).status, 401);
    assert.equal((await f.login('Friend', body.password)).status, 200);
    assert.equal((await f.profiles.find('Friend'))!.id, friend.id);
    const listing = await accountsResponse(new Request('https://game.test/api/admin/accounts', { headers: { cookie: admin } }), f.config, f.profiles);
    assert.doesNotMatch(await listing.text(), /pbkdf2|passwordHash|replacement-password/);
    assert.equal((await handle(`/api/admin/accounts/${f.owner.id}/password`, { confirmation: 'Owner', password: 'new-owner-password' }, admin)).status, 200);
    const freshOwner = await f.login('Owner', 'new-owner-password');
    const newCookie = freshOwner.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await handle(path, body, `${newCookie}; ${unlocked.headers.get('set-cookie')!.split(';')[0]}`)).status, 403, 'An old admin unlock must not survive owner password rotation.');
});
