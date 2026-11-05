import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { calculatePKCECodeChallenge } from 'oauth4webapi';
import { hashPassword } from '../../src/auth/passwords';
import { sqlProfiles } from '../../src/auth/profiles';
import { sessionResponse } from '../../src/auth/session';
import { worldsConfig, worldsPilotTarget, worldsResponse } from '../../src/auth/worlds';
import { SESSION_COOKIE, token } from '../../src/auth/worlds-shared/oidc.ts';
import { hash } from '../../src/auth/worlds-shared/store.ts';
import { WORLDS_SCHEMA } from '../../src/database/worlds-schema';

const origin = 'https://slop-pilot.test';
const issuer = 'https://identity.test/auth';
const password = 'a unique test password';
const env = { WORLDS_PILOT_ENABLED: 'true', WORLDS_PILOT_ORIGIN: origin, WORLDS_PILOT_DATABASE_HOST: 'db.test',
    DATABASE_URL: 'postgres://db.test/test', WORLDS_ISSUER: issuer, WORLDS_CLIENT_ID: 'slop-pilot', WORLDS_RESOURCE: origin + '/api',
    WORLDS_REAUTH_ENABLED: 'true' };

test('the pilot fails closed without an exact isolated target and rejects the production origin and database', async () => {
    assert.equal(worldsPilotTarget({}), undefined);
    assert.equal(worldsPilotTarget({...env, WORLDS_PILOT_DATABASE_HOST: 'wrong.test'}), undefined);
    assert.equal(worldsPilotTarget({...env, WORLDS_PILOT_ORIGIN: 'https://slopurself.maki26.workers.dev'}), undefined);
    for (const endpoint of ['ep-holy-voice-b1djk94x', 'ep-holy-voice-b1djk94x-pooler']) {
        const host = endpoint + '.c-5.eu-central-1.aws.neon.tech';
        assert.equal(worldsPilotTarget({...env, DATABASE_URL: 'postgres://' + host + '/test', WORLDS_PILOT_DATABASE_HOST: host}), undefined);
    }
    const unexpected = async () => { throw new Error('Database must remain unused'); };
    assert.equal((await worldsResponse(new Request(origin + '/auth/worlds'), undefined, {}, {} as never, unexpected)).status, 404);
});

test('Slop Worlds linking checks both proofs and atomically keeps the local profile and separate HF credentials', async t => {
    const db = new PGlite();
    try {
        const query = async (text: string, values?: unknown[]) => (await db.query<Record<string, unknown>>(text, values)).rows;
        const profiles = sqlProfiles(async (text, values) => (await db.query<{id: string; name: string}>(text, values)).rows);
        const protectedProfile = (await profiles.create('Protected', await hashPassword(password)))!;
        const open = (await profiles.create('Open'))!;
        const admin = (await profiles.create('Admin', await hashPassword(password)))!;
        for (const statement of WORLDS_SCHEMA) await query(statement);
        const config = worldsConfig(env, query)!;
        const local = { AUTH_COOKIE_SECRET: 'a local test signing secret long enough', ADMIN_ACCOUNT_ID: admin.id };
        const login = async (username: string, secret?: string) => {
            const response = await sessionResponse(new Request(origin + '/api/session', {method: 'POST', headers: {origin},
                body: JSON.stringify({mode: 'login', username, password: secret})}), local, profiles);
            assert.equal(response.status, 200);
            return response.headers.get('set-cookie')!.split(';')[0];
        };
        const localCookie = await login(protectedProfile.name, password);
        const openCookie = await login(open.name);
        const adminCookie = await login(admin.name, password);
        async function central(authenticatedAt?: number) {
            const raw = token(), csrf = token(), sub = token(), expires = Date.now() + 600_000;
            const key = await hash(raw);
            await config.store.putSession(key, {issuer, sub, csrf, expires, authenticatedAt, email: 'fixture@example.test'});
            return {key, csrf, sub, cookie: SESSION_COOKIE + '=' + raw};
        }
        const fresh = await central(Date.now()), stale = await central(Date.now() - 300_001);
        const post = (binding: typeof fresh, cookie: string, options: {password?: string; csrf?: string; origin?: string} = {},
            execute = query, reauthEnabled = true) => worldsResponse(new Request(origin + '/auth/worlds/link', {
            method: 'POST', headers: {origin: options.origin ?? origin, cookie: binding.cookie + '; ' + cookie},
            body: new URLSearchParams({csrf: options.csrf ?? binding.csrf, password: options.password ?? password})
        }), {...config, reauthEnabled}, local, profiles, execute);

        assert.equal((await post(fresh, localCookie, {origin: 'https://elsewhere.test'})).status, 403);
        assert.equal((await post(fresh, localCookie, {csrf: token()})).status, 403);
        assert.equal((await post(fresh, localCookie, {password: 'incorrect password'})).status, 403);
        assert.equal((await post(stale, localCookie)).status, 403);
        assert.equal((await post(fresh, '', {})).status, 403);
        assert.equal((await post(fresh, openCookie)).status, 403);
        assert.equal((await post(fresh, adminCookie)).status, 403);
        assert.equal((await post(fresh, localCookie, {}, query, false)).status, 403);

        assert.equal((await post(fresh, localCookie, {}, async (text, values) => {
            await config.store.deleteSession(fresh.key);
            return query(text, values);
        })).status, 403);
        const {privateKey, publicKey} = await generateKeyPair('EdDSA', {extractable: true});
        const jwk = {...await exportJWK(publicKey), kid: 'fixture', alg: 'EdDSA'};
        let authorization: URL;
        t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
            const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
            if (path === '/auth/.well-known/openid-configuration') return Response.json({
                issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
                jwks_uri: issuer + '/keys', code_challenge_methods_supported: ['S256']
            });
            if (path === '/auth/keys') return Response.json({keys: [jwk]});
            assert.equal(path, '/auth/token');
            const params = new URLSearchParams(init?.body as URLSearchParams);
            assert.equal(params.get('redirect_uri'), origin + '/auth/callback');
            assert.equal(params.get('resource'), env.WORLDS_RESOURCE);
            assert.equal(await calculatePKCECodeChallenge(params.get('code_verifier')!), authorization.searchParams.get('code_challenge'));
            const now = Math.floor(Date.now() / 1000);
            const id = await new SignJWT({iss: issuer, aud: env.WORLDS_CLIENT_ID, sub: 'signed-subject',
                nonce: authorization.searchParams.get('nonce'), email: 'fixture@example.test', email_verified: true,
                auth_time: now, iat: now, exp: now + 300}).setProtectedHeader({alg: 'EdDSA', kid: 'fixture'}).sign(privateKey);
            return Response.json({id_token: id, access_token: 'server-only', token_type: 'Bearer'});
        });
        const start = await worldsResponse(new Request(origin + '/auth/login?reauth=1&next=https://elsewhere.test',
            {method: 'POST', headers: {origin}}), config, local, profiles, query);
        assert.equal(start.status, 303);
        authorization = new URL(start.headers.get('location')!);
        assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
        const callbackRequest = new Request(origin + '/auth/callback?' + new URLSearchParams({code: 'fixture-code',
            state: authorization.searchParams.get('state')!}), {headers: {cookie: start.headers.getSetCookie()[0].split(';')[0]}});
        const callback = await worldsResponse(callbackRequest, config, local, profiles, query);
        assert.equal(callback.headers.get('location'), '/auth/worlds');
        assert.equal((await worldsResponse(callbackRequest, config, local, profiles, query)).status, 400);
        const sessionCookie = callback.headers.getSetCookie().find(value => value.startsWith(SESSION_COOKIE + '='))!.split(';')[0];
        const key = await hash(sessionCookie.slice(SESSION_COOKIE.length + 1));
        const verified = await config.store.getSession(key);
        assert.equal(verified?.sub, 'signed-subject');
        assert.doesNotMatch(sessionCookie, /server-only|eyJ/);
        const second = {key, csrf: verified!.csrf, sub: verified!.sub, cookie: sessionCookie};
        assert.equal((await post(second, localCookie, {}, async (text, values) => {
            await profiles.setPassword(protectedProfile.id, await hashPassword(password));
            return query(text, values);
        })).status, 403);
        const renewed = await login(protectedProfile.name, password);
        const parallel = await Promise.all([post(second, renewed), post(second, renewed)]);
        assert.deepEqual(parallel.map(response => response.status).sort(), [303, 403]);
        const [link] = await query('SELECT issuer, subject, local_user_id FROM worlds_identity_links');
        assert.deepEqual(link, {issuer, subject: second.sub, local_user_id: protectedProfile.id});
        assert.deepEqual(await query('SELECT event FROM worlds_link_audit'), [{event: 'linked'}]);
        assert.equal((await profiles.find(protectedProfile.name))?.id, protectedProfile.id);
        const third = await central(Date.now());
        assert.equal((await post(third, renewed)).status, 403);
        const centralOnly = await sessionResponse(new Request(origin + '/api/session', {headers: {cookie: second.cookie}}), local, profiles);
        assert.equal(centralOnly.status, 401, 'Pilot linkage does not mint a game or HF credential');
    } finally { await db.close(); }
});
