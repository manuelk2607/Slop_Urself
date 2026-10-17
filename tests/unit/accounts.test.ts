import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { storedProfiles } from '../../src/auth/profiles';
import { profileAuthConfig, requestAccount, sessionResponse, verifyAccountToken } from '../../src/auth/session';
import { accountsResponse } from '../../src/server/accounts';

async function setup() {
    const store = new Map<string, unknown>();
    const profiles = storedProfiles({ get: async <T>(key: string) => store.get(key) as T | undefined, put: async (key, value) => { store.set(key, value); } });
    const owner = (await profiles.create('Manuel'))!;
    const friend = (await profiles.create('Änne'))!;
    const config = { AUTH_COOKIE_SECRET: 'unit-test-session-signing-secret-at-least-32', ADMIN_ACCOUNT_ID: owner.id, ADMIN_ACCESS_KEY: 'unit-test-private-admin-key-at-least-32-characters' };
    const session = async (name: string) => {
        const response = await sessionResponse(new Request('https://game.test/api/session', { method: 'POST', headers: { origin: 'https://game.test' }, body: JSON.stringify({ mode: 'login', username: name }) }), config, profiles);
        return { cookie: response.headers.getSetCookie()[0].split(';')[0], ...await response.json() as { token: string } };
    };
    const ownerSession = await session(owner.name), friendSession = await session(friend.name);
    const request = (path = '/api/admin/accounts', method = 'GET', cookie = ownerSession.cookie, body?: unknown, origin = 'https://game.test') => new Request(`https://game.test${path}`, { method, headers: { cookie, origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const handle = (path?: string, method?: string, cookie?: string, body?: unknown, origin?: string) => accountsResponse(request(path, method, cookie, body, origin), config, profiles);
    const unlock = async () => {
        const response = await handle('/api/admin/session', 'POST', ownerSession.cookie, { key: config.ADMIN_ACCESS_KEY });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict; Path=\/api\/admin.*Secure/);
        return `${ownerSession.cookie}; ${response.headers.get('set-cookie')!.split(';')[0]}`;
    };
    return { config, profiles, owner, friend, ownerSession, friendSession, request, handle, unlock };
}

test('admin deletion is unavailable without configuration and cannot be unlocked by a normal profile', async () => {
    const s = await setup();
    assert.equal((await s.handle('/api/admin/accounts', 'GET', '')).status, 401);
    assert.deepEqual(await (await s.handle('/api/admin/accounts', 'GET', s.friendSession.cookie)).json(), { available: false, unlocked: false, accounts: [] });
    assert.equal((await s.handle('/api/admin/session', 'POST', s.friendSession.cookie, { key: s.config.ADMIN_ACCESS_KEY })).status, 403);
    const disabled = { ...s.config, ADMIN_ACCESS_KEY: undefined };
    assert.equal((await accountsResponse(s.request('/api/admin/session', 'POST', undefined, { key: s.config.ADMIN_ACCESS_KEY }), disabled, s.profiles)).status, 403);
    assert.equal((await s.profiles.list()).length, 2);
});

test('a username-only owner login cannot delete accounts without separate admin proof', async () => {
    const s = await setup();
    assert.deepEqual(await (await s.handle()).json(), { available: true, unlocked: false, accounts: [] });
    const url = `/api/admin/accounts/${s.friend.id}`;
    assert.equal((await s.handle(url, 'DELETE', s.ownerSession.cookie, { confirmation: s.friend.name })).status, 403);
    assert.equal((await s.handle('/api/admin/session', 'POST', undefined, { key: 'wrong-key' })).status, 403);
    assert.equal((await s.handle('/api/admin/session', 'POST', undefined, { key: s.config.ADMIN_ACCESS_KEY }, 'https://evil.test')).status, 403);
    const cookie = await s.unlock();
    const fake = cookie.replace(s.ownerSession.cookie, s.friendSession.cookie);
    assert.equal((await s.handle(url, 'DELETE', fake, { confirmation: s.friend.name })).status, 403);
    assert.equal((await s.handle(url, 'GET', cookie)).status, 405);
    assert.equal((await s.profiles.list()).length, 2);
});

test('owner management lists profiles without games and requires an exact deletion confirmation', async () => {
    const s = await setup(), cookie = await s.unlock();
    const data = await (await s.handle('/api/admin/accounts', 'GET', cookie)).json() as any;
    assert.equal(data.unlocked, true); assert.equal(data.accounts.length, 2);
    assert.equal(data.accounts.find((item: any) => item.id === s.owner.id).protected, true);
    assert.equal((await s.handle(`/api/admin/accounts/${s.owner.id}`, 'DELETE', cookie, { confirmation: s.owner.name })).status, 403);
    assert.equal((await s.handle(`/api/admin/accounts/${s.friend.id}`, 'DELETE', cookie, {})).status, 400);
    assert.equal((await s.handle(`/api/admin/accounts/${s.friend.id}`, 'DELETE', cookie, { confirmation: 'WrongName' })).status, 409);
    assert.equal((await s.handle(`/api/admin/accounts/${s.friend.id}`, 'DELETE', cookie, { confirmation: s.friend.name })).status, 200);
    assert.equal(await s.profiles.find(s.friend.name), undefined);
    assert.equal((await s.profiles.list()).length, 1);
});

test('deleting a profile revokes old cookies, refreshed JWTs and reuse of the same username', async () => {
    const s = await setup(), cookie = await s.unlock();
    assert.equal((await s.handle(`/api/admin/accounts/${s.friend.id}`, 'DELETE', cookie, { confirmation: s.friend.name })).status, 200);
    const auth = profileAuthConfig(s.config, s.profiles);
    await assert.rejects(requestAccount(s.request('/api/stats', 'GET', s.friendSession.cookie), auth), /gelöscht/);
    await assert.rejects(verifyAccountToken(s.friendSession.token, auth), /gelöscht/);
    assert.equal((await sessionResponse(s.request('/api/session', 'GET', s.friendSession.cookie), s.config, s.profiles)).status, 401);
    assert.equal((await sessionResponse(s.request('/api/session', 'POST', s.friendSession.cookie, { mode: 'refresh' }), s.config, s.profiles)).status, 401);
    const replacement = (await s.profiles.create(s.friend.name))!;
    assert.notEqual(replacement.id, s.friend.id);
    await assert.rejects(verifyAccountToken(s.friendSession.token, auth), /gelöscht/);
});

test('temporary profile outages return 503 without revoking a valid session or refreshing it as anonymous', async () => {
    const s = await setup();
    const unavailable = { ...s.profiles, find: async () => { throw new Error('DB down'); } };
    const auth = profileAuthConfig(s.config, unavailable);
    assert.equal((await sessionResponse(s.request('/api/session', 'GET'), auth, unavailable)).status, 503);
    assert.equal((await sessionResponse(s.request('/api/session', 'POST', undefined, { mode: 'refresh' }), auth, unavailable)).status, 503);
    assert.equal((await accountsResponse(s.request(), auth, unavailable)).status, 503);
    assert.equal((await sessionResponse(s.request('/api/session', 'GET'), s.config, s.profiles)).status, 200);
});

test('admin cookies expire, reject wrong roles, are revoked by key rotation and clear on logout', async () => {
    const s = await setup(), cookie = await s.unlock();
    const url = `/api/admin/accounts/${s.friend.id}`;
    const expired = await new SignJWT({ role: 'admin' }).setSubject(s.owner.id).setProtectedHeader({ alg: 'HS256' }).setIssuer('slopurself').setAudience('administration').setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(new TextEncoder().encode(s.config.ADMIN_ACCESS_KEY));
    assert.equal((await s.handle(url, 'DELETE', `${s.ownerSession.cookie}; slop_admin=${expired}`, { confirmation: s.friend.name })).status, 403);
    const wrongRole = await new SignJWT({ role: 'player' }).setSubject(s.owner.id).setProtectedHeader({ alg: 'HS256' }).setIssuer('slopurself').setAudience('administration').setExpirationTime('1h').sign(new TextEncoder().encode(s.config.ADMIN_ACCESS_KEY));
    assert.equal((await s.handle(url, 'DELETE', `${s.ownerSession.cookie}; slop_admin=${wrongRole}`, { confirmation: s.friend.name })).status, 403);
    const rotated = { ...s.config, ADMIN_ACCESS_KEY: 'different-admin-key-with-more-than-32-characters' };
    assert.equal((await accountsResponse(s.request(url, 'DELETE', cookie, { confirmation: s.friend.name }), rotated, s.profiles)).status, 403);
    const lock = await s.handle('/api/admin/session', 'DELETE', cookie);
    assert.match(lock.headers.get('set-cookie')!, /Max-Age=0/);
    const logout = await sessionResponse(s.request('/api/session', 'DELETE', cookie), s.config, s.profiles);
    assert.equal(logout.headers.getSetCookie().length, 4);
    assert.match(logout.headers.getSetCookie()[1], /slop_admin=.*Max-Age=0/);
    assert.match(logout.headers.getSetCookie()[2], /slop_hf=.*Max-Age=0/);
    assert.match(logout.headers.getSetCookie()[3], /slop_hf_oauth=.*Max-Age=0/);
});
