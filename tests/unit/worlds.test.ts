import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { calculatePKCECodeChallenge } from 'oauth4webapi';
import { hashPassword } from '../../src/auth/passwords';
import { sqlProfiles } from '../../src/auth/profiles';
import { accountIsCurrent, profileAuthConfig, requestAccount, sessionResponse } from '../../src/auth/session';
import { worldsAccounts, worldsConfig, worldsPilotTarget, worldsResponse } from '../../src/auth/worlds';
import { reportWorldsLinks } from '../../src/auth/worlds-receipts';
import { HfConnections, HfRequiredError, requirePlayerHf, type HfStorage } from '../../src/auth/huggingface';
import { SESSION_COOKIE, token } from '../../src/auth/worlds-shared/oidc.ts';
import { hash } from '../../src/auth/worlds-shared/store.ts';
import { sessionEventContentType, sessionRevocationPath, signSessionRevocation } from '../../src/auth/worlds-shared/session-revocation.ts';
import { WORLDS_SCHEMA } from '../../src/database/worlds-schema';
import worker from '../../src/server/cloudflare/worker';
import type { Env } from '../../src/server/cloudflare/types';

const origin = 'https://slop-pilot.test';
const issuer = 'https://identity.test/auth';
const password = 'a unique test password';
const env = { WORLDS_PILOT_ENABLED: 'true', WORLDS_PILOT_ORIGIN: origin, WORLDS_PILOT_DATABASE_HOST: 'db.test',
    DATABASE_URL: 'postgres://db.test/test', WORLDS_ISSUER: issuer, WORLDS_CLIENT_ID: 'slop-pilot', WORLDS_RESOURCE: origin + '/api',
    WORLDS_REAUTH_ENABLED: 'true' };

test('signed Worlds sign-out invalidates both previous credentials for the linked player', async () => {
    const db = new PGlite();
    try {
        const query = async (text: string, values?: unknown[]) => (await db.query<Record<string, unknown>>(text, values)).rows;
        const profiles = sqlProfiles(async (text, values) => (await db.query<{id: string; name: string}>(text, values)).rows);
        const linked = (await profiles.create('Linked'))!;
        const other = (await profiles.create('Other'))!;
        for (const statement of WORLDS_SCHEMA) await query(statement);
        const {privateKey, publicKey} = await generateKeyPair('EdDSA', {extractable: true});
        const {kty, crv, x} = await exportJWK(publicKey);
        const kid = 'fixture', subject = token();
        const config = worldsConfig({...env, WORLDS_HUB_SESSION_EVENT_JWK: JSON.stringify({kty, crv, x, kid})}, query)!;
        const local = {AUTH_COOKIE_SECRET: 'a local test signing secret long enough', worlds: worldsAccounts(config, query)};
        const auth = profileAuthConfig(local, profiles);
        const account = (cookie: string) => requestAccount(new Request(origin + '/api/session', {headers: {cookie}}), auth);
        const login = async (username: string) => {
            const response = await sessionResponse(new Request(origin + '/api/session', {
                method: 'POST', headers: {origin}, body: JSON.stringify({mode: 'login', username})
            }), local, profiles);
            assert.equal(response.status, 200);
            return response.headers.get('set-cookie')!.split(';')[0];
        };
        const legacy = await login(linked.name), unrelated = await login(other.name);
        const cutoff = Math.ceil(Date.now() / 1000) * 1000;
        await query('INSERT INTO worlds_identity_links(issuer,subject,local_user_id) VALUES($1,$2,$3)', [issuer, subject, linked.id]);
        async function central(authenticatedAt: number) {
            const raw = token();
            await config.store.putSession(await hash(raw), {issuer, sub: subject, csrf: token(), expires: cutoff + 60_000, authenticatedAt});
            return SESSION_COOKIE + '=' + raw;
        }
        const previous = await central(cutoff - 1000), fresh = await central(cutoff + 1000);
        assert.equal((await account(legacy))?.id, linked.id);
        assert.equal((await account(previous))?.id, linked.id);
        const audience = origin + sessionRevocationPath;
        const event = {eventId: token(), identityIssuer: issuer, subject, revokedThrough: cutoff};
        const deliver = (body: string) => worldsResponse(new Request(audience, {
            method: 'POST', headers: {'Content-Type': sessionEventContentType}, body
        }), config, local, profiles, query);
        const signed = (signer: string) => signSessionRevocation(event, signer, audience, {kid, privateKey}, cutoff);
        assert.equal((await deliver(await signed('https://invalid.test'))).status, 400);
        const message = await signed('https://worlds-hub.maki26.workers.dev');
        assert.equal((await deliver(message)).status, 202);
        assert.equal((await deliver(message)).status, 202);
        await assert.rejects(() => account(previous));
        await assert.rejects(() => account(legacy));
        assert.equal((await account(unrelated))?.id, other.id);
        assert.equal((await account(fresh))?.id, linked.id);
        assert.deepEqual(await query('SELECT local_user_id FROM worlds_identity_links'), [{local_user_id: linked.id}]);
    } finally {
        await db.close();
    }
});

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

test('production Worlds sign-in requires the exact live database and client and keeps the transition available', async () => {
    const origin = 'https://slopurself.maki26.workers.dev';
    const production = {
        WORLDS_PRODUCTION_ENABLED: 'true',
        DATABASE_URL: 'postgres://ep-holy-voice-b1djk94x-pooler.c-5.eu-central-1.aws.neon.tech/Slop_Urself',
        WORLDS_ISSUER: 'https://ep-bold-boat-batl101c.neonauth.c-8.eu-central-1.aws.neon.tech/worlds_identity/auth',
        WORLDS_CLIENT_ID: 'BBHPxFFlfMahuTkpeBpLeUfkqjVGYfPO',
        WORLDS_RESOURCE: origin + '/api',
        AUTH_COOKIE_SECRET: 'test-only-cookie-secret-for-rate-limit',
        SERVICES: { idFromName: () => 'test', get: () => ({ fetch: async () => Response.json({ retryAfter: 0 }) }) },
    };
    const query = async () => { throw new Error('Anonymous account page must not query the database'); };
    assert.equal(worldsConfig(production, query)?.origin, origin);
    const admin = worldsAccounts(worldsConfig(production, query), query, 'admin')!;
    assert.equal(await admin.requiresCentral?.('admin'), false);
    assert.equal(await admin.legacyAllowed?.({id:'admin',name:'Admin',expiresAt:Date.now()+1000}), true);
    for (const config of [
        {...production, WORLDS_PRODUCTION_ENABLED: 'false'},
        {...production, WORLDS_CLIENT_ID: env.WORLDS_CLIENT_ID},
        {...production, DATABASE_URL: env.DATABASE_URL},
        {...production, WORLDS_PILOT_ENABLED: 'true'},
    ]) assert.equal(worldsConfig(config, query), undefined);
    const account = await worker.fetch(new Request(origin + '/auth/worlds'), production as unknown as Env);
    assert.equal(account.status, 200);
    const html = await account.text();
    assert.match(html, /Mit Worlds anmelden/);
    assert.doesNotMatch(html, /Testversion/);
    const config = await worker.fetch(new Request(origin + '/api/config'), production as unknown as Env);
    const data = await config.json() as { worldsTransition: boolean; hfRequired: boolean };
    assert.equal(data.worldsTransition, true);
    assert.equal(data.hfRequired, true);
});

test('the dedicated Cloudflare pilot excludes indexing and refuses a real generator or disabled authentication', async () => {
    const deployment = {...env, WORLDS_PILOT_DEPLOYMENT: 'true', AI_PROVIDER: 'mock'} as Env;
    const robots = await worker.fetch(new Request(origin + '/robots.txt'), deployment);
    assert.match(await robots.text(), /^User-agent: \*\nDisallow: \/\n$/);
    assert.match(robots.headers.get('x-robots-tag')!, /noindex/);
    const sitemap = await worker.fetch(new Request(origin + '/sitemap.xml'), deployment);
    assert.equal(sitemap.status, 404);
    for (const invalid of [{...deployment, AI_PROVIDER: 'wan22'}, {...deployment, AUTH_MODE: 'disabled'},
        {...deployment, DATABASE_URL: 'postgres://another-db.test/test'}]) {
        const response = await worker.fetch(new Request(origin + '/'), invalid);
        assert.equal(response.status, 503);
        assert.match(response.headers.get('x-robots-tag')!, /noindex/);
    }
});

test('the isolated pilot reports its real binding version and never trusts the requested override', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const deployment = {...env, WORLDS_PILOT_DEPLOYMENT: 'true', AI_PROVIDER: 'mock', WORLDS_PILOT_VERSION: {id}} as Env;
    const response = await worker.fetch(new Request(origin + '/robots.txt', {headers: {
        'Cloudflare-Workers-Version-Overrides': 'slopurself-worlds-pilot="00000000-0000-4000-8000-000000000002"',
        'X-Worlds-Pilot-Version': 'untrusted'
    }}), deployment);
    assert.equal(response.headers.get('x-worlds-pilot-version'), id);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-robots-tag')!, /noindex/);
    for (const config of [{...deployment, WORLDS_PILOT_DEPLOYMENT: undefined},
        {...deployment, WORLDS_PILOT_VERSION: undefined}, {...deployment, WORLDS_PILOT_VERSION: {id: 'invalid'}}]) {
        const ordinary = await worker.fetch(new Request(origin + '/robots.txt'), config);
        assert.equal(ordinary.headers.get('x-worlds-pilot-version'), null);
    }
});

test('the migration outbox retries committed records and records rollback without changing the profile', async t => {
    const db = new PGlite();
    try {
        const query = async (text: string, values?: unknown[]) => (await db.query<Record<string, unknown>>(text, values)).rows;
        const profiles = sqlProfiles(async (text, values) => (await db.query<{id: string; name: string}>(text, values)).rows);
        const profile = (await profiles.create('Receipt profile'))!;
        for (const statement of WORLDS_SCHEMA) await query(statement);
        const pair = await generateKeyPair('EdDSA', {extractable: true});
        const audience = 'https://hub-pilot.test/api/migrations/receipts/slop-urself';
        const delivery = {...env, WORLDS_RECEIPT_URL: audience, WORLDS_RECEIPT_KID: 'fixture',
            WORLDS_RECEIPT_KEY: JSON.stringify(await exportJWK(pair.privateKey))};
        const bindings = [issuer, 'subject', profile.id];
        const unexpected = async () => { throw new Error('Database must remain unused'); };
        await reportWorldsLinks(env, unexpected);
        await assert.rejects(() => reportWorldsLinks({...delivery,
            WORLDS_RECEIPT_URL: audience.replace('hub-pilot.test', 'worlds-hub.maki26.workers.dev')}, unexpected),
        /Invalid Worlds receipt configuration/);

        await query(`WITH linked AS (
            INSERT INTO worlds_identity_links (issuer, subject, local_user_id) VALUES ($1,$2,$3) RETURNING *
        ) INSERT INTO worlds_link_audit (issuer, subject, local_user_id, event)
          SELECT issuer, subject, local_user_id, 'linked' FROM linked`, bindings);
        const config = worldsConfig(env, query)!;
        const session = {issuer, sub: 'subject', csrf: token(), expires: Date.now() + 60_000};
        await config.store.putSession('linked-session', session);
        await config.store.putSession('other-session', {...session, sub: 'other-subject'});
        const unlink = 'DELETE FROM worlds_identity_links WHERE issuer=$1 AND subject=$2 AND local_user_id=$3';
        await db.exec('BEGIN');
        await query(unlink, bindings);
        await db.exec('ROLLBACK');
        assert.deepEqual(await query('SELECT event FROM worlds_link_audit'), [{event: 'linked'}]);

        assert.ok(await config.store.getSession('linked-session'));

        const receipts: {revision: unknown; state: unknown}[] = [];
        t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
            assert.equal(url, audience);
            assert.equal(request.redirect, 'error');
            assert.deepEqual(request.headers, {'content-type': 'application/jwt'});
            const {payload} = await jwtVerify(String(request.body), pair.publicKey, {
                algorithms: ['EdDSA'], issuer: 'https://slopurself.maki26.workers.dev',
                audience, subject: 'subject', typ: 'worlds-migration-receipt+jwt'
            });
            assert.equal(payload.identity_issuer, issuer);
            assert.equal(payload.account_ref, await hash('worlds:slop-urself:' + profile.id));
            assert.doesNotMatch(JSON.stringify(payload), new RegExp(profile.id));
            receipts.push({revision: payload.revision, state: payload.state});
            if (receipts.length === 1) throw new Error('acknowledgement lost');
            if (payload.state === 'revoked') return Response.json({error: 'RECEIPT_CONFLICT'}, {status: 409});
            return Response.json({result: 'duplicate'});
        });
        await assert.rejects(() => reportWorldsLinks(delivery, query), /endpoint is unavailable/);
        assert.deepEqual(await query('SELECT receipt_reported_at IS NULL AS pending FROM worlds_link_audit'), [{pending: true}]);
        await reportWorldsLinks(delivery, query);
        await query(unlink, bindings);
        assert.equal((await profiles.find(profile.name))?.id, profile.id);
        assert.equal(await config.store.getSession('linked-session'), null);
        assert.ok(await config.store.getSession('other-session'));
        await reportWorldsLinks(delivery, query);
        await reportWorldsLinks(delivery, query);
        assert.deepEqual(receipts, [
            {revision: 1, state: 'confirmed'}, {revision: 1, state: 'confirmed'}, {revision: 3, state: 'revoked'}
        ]);
        assert.deepEqual(await query(`SELECT event, receipt_reported_at IS NOT NULL AS sent,
            receipt_conflict_at IS NOT NULL AS conflict FROM worlds_link_audit ORDER BY id`), [
            {event: 'linked', sent: true, conflict: false}, {event: 'unlinked', sent: false, conflict: true}
        ]);
    } finally { await db.close(); }
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
        const accountPage=(cookie:string,locale='de')=>worldsResponse(new Request(origin+'/auth/worlds?ui_locales='+locale,{headers:{cookie}}),config,local,profiles,query);
        const centralOnly=await accountPage(fresh.cookie);const centralHtml=await centralOnly.text();
        assert.match(centralHtml,/Bei Worlds angemeldet/);assert.match(centralHtml,/Für dieses Konto ist in der Testversion noch kein Spielprofil zugeordnet/);
        assert.doesNotMatch(centralHtml,/name="password"/);assert.match(centralHtml,/href="\/style.css"/);
        assert.match(centralOnly.headers.get('content-security-policy')!,/style-src 'self'/);
        assert.match(centralOnly.headers.get('content-security-policy')!,/form-action 'self' https:;/);
        const ownedHtml=await(await accountPage(fresh.cookie+'; '+localCookie,'en')).text();
        assert.match(ownedHtml,/<html lang="en"/);assert.match(ownedHtml,/Your active game profile/);
        assert.match(ownedHtml,/name="password"/);assert.match(ownedHtml,/Link this profile to Worlds/);
        for(const notEligible of [openCookie,adminCookie])assert.doesNotMatch(await(await accountPage(fresh.cookie+'; '+notEligible)).text(),/name="password"/);
        const staleHtml=await(await accountPage(stale.cookie+'; '+localCookie)).text();
        assert.doesNotMatch(staleHtml,/name="password"/);assert.match(staleHtml,/erneut bestätigen/);

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
        let hfExchanges = 0;
        t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            const path = url.pathname;
            if (url.hostname === 'huggingface.co') {
                if (path === '/oauth/token') {
                    hfExchanges++;
                    return Response.json({access_token: 'separate-hf-fixture', token_type: 'Bearer', expires_in: 600});
                }
                assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer separate-hf-fixture');
                if (path === '/oauth/userinfo') return Response.json({sub: 'hf-owner', preferred_username: 'hf_owner'});
                if (path === '/api/whoami-v2') return Response.json({id: 'hf-owner', name: 'hf_owner'});
                if (path.endsWith('/zero-gpu/quota')) return Response.json({base: 300, current: 300, resetsAt: null, runs: {remaining: 8}});
                assert.fail('Unexpected HF endpoint');
            }
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
        const linkedPage=await(await accountPage(second.cookie,'en')).text();assert.match(linkedPage,/Game profile linked/);assert.match(linkedPage,/Play with this profile/);assert.doesNotMatch(linkedPage,/name="password"/);

        assert.equal((await profiles.find(protectedProfile.name))?.id, protectedProfile.id);
        const third = await central(Date.now());
        assert.equal((await post(third, renewed)).status, 403);
        const settings = { ...local, AI_PROVIDER: 'wan22', worlds: worldsAccounts(config, query, admin.id) };
        const auth = profileAuthConfig(settings, profiles);
        const sessionRequest = (cookie: string, method = 'GET') => new Request(origin + '/api/session', {
            method, headers: {origin, cookie}, body: method === 'POST' ? '{"mode":"refresh"}' : undefined
        });
        const account = (await requestAccount(sessionRequest(second.cookie), auth))!;
        assert.equal(account.id, protectedProfile.id);
        assert.equal(account.hfConnectionId, undefined);
        assert.equal(await accountIsCurrent(account, auth), true);
        assert.equal((await requestAccount(sessionRequest(second.cookie + '; ' + openCookie), auth))?.id, open.id,
            'An active legacy login does not switch accounts silently');
        const switchAccount = (originHeader = origin) => worldsResponse(new Request(origin + '/auth/worlds/play', {method: 'POST',
            headers: {origin: originHeader, cookie: second.cookie + '; ' + openCookie}, body: new URLSearchParams({csrf: second.csrf})
        }), config, local, profiles, query);
        assert.equal((await switchAccount('https://elsewhere.test')).status, 403);
        assert.match((await switchAccount()).headers.get('set-cookie')!, /slop_auth=;/);
        await assert.rejects(() => requestAccount(new Request('https://other-game.test/api/session', {headers: {cookie: second.cookie}}), auth));
        for (const method of ['GET', 'POST']) {
            const response = await sessionResponse(sessionRequest(second.cookie, method), auth, profiles);
            assert.equal(response.status, 200);
            const body = await response.json() as Record<string, unknown>;
            assert.deepEqual(body.account, {id: account.id, name: account.name, expiresAt: account.expiresAt});
            assert.equal(body.token, undefined);
            assert.doesNotMatch(JSON.stringify(body), /worldsSessionKey|hfConnectionId/);
        }

        const encrypted = new Map<string, unknown>();
        const storage: HfStorage = {get: async <T>(key: string) => encrypted.get(key) as T,
            put: async (key, value) => { encrypted.set(key, value); }, delete: async key => encrypted.delete(key)};
        const hf = new HfConnections(storage, auth);
        await assert.rejects(() => requirePlayerHf(settings, account, hf), HfRequiredError);
        const pending = await hf.start(account, origin);
        const linkedHf = await hf.finish(new URL(pending.url).searchParams.get('state'), 'hf-code', pending.nonce, origin);
        const bothCookies = second.cookie + '; slop_hf=' + linkedHf.connection;
        const withHf = await requestAccount(sessionRequest(bothCookies), auth);
        await requirePlayerHf(settings, withHf, hf);
        await assert.rejects(() => requirePlayerHf(settings, {...withHf!, id: open.id}, hf), HfRequiredError);
        assert.doesNotMatch(JSON.stringify([...encrypted.values()]), /separate-hf-fixture/);
        await profiles.setPassword(protectedProfile.id, await hashPassword(password));
        assert.equal(await accountIsCurrent(account, auth), false);
        await assert.rejects(() => requestAccount(sessionRequest(second.cookie), auth));
        const freshCookie = token(), freshKey = await hash(freshCookie);
        await config.store.putSession(freshKey, {...verified!, expires: Date.now() + 600_000});
        const newBrowser = SESSION_COOKIE + '=' + freshCookie;
        const reconnected = (await requestAccount(sessionRequest(newBrowser), auth))!;
        assert.equal(reconnected.id, protectedProfile.id);
        const otherBrowser = token(), otherKey = await hash(otherBrowser);
        await config.store.putSession(otherKey, {...verified!, sid: 'signed-backchannel-fixture', expires: Date.now() + 600_000});
        const logoutToken = await new SignJWT({sid: 'signed-backchannel-fixture', sub: verified!.sub,
            events: {'http://schemas.openid.net/event/backchannel-logout': {}}})
            .setProtectedHeader({alg: 'EdDSA', kid: 'fixture'}).setIssuer(issuer).setAudience(env.WORLDS_CLIENT_ID)
            .setIssuedAt().setJti(token()).sign(privateKey);
        const backchannel = new Request(origin + '/auth/backchannel-logout', {method: 'POST',
            body: new URLSearchParams({logout_token: logoutToken})});
        assert.equal((await worldsResponse(backchannel, config, local, profiles, query)).status, 200);
        assert.equal(await config.store.getSession(otherKey), null);
        assert.equal(await accountIsCurrent(reconnected, auth), true);
        const pendingLogout = await hf.start(reconnected, origin);
        const logout = await sessionResponse(sessionRequest(newBrowser, 'DELETE'), auth, profiles);
        assert.equal(logout.status, 200);
        assert.match(logout.headers.get('set-cookie')!, /__Host-worlds-session=;/);
        assert.equal(await accountIsCurrent(reconnected, auth), false);
        assert.equal(await config.store.getSession(freshKey), null);
        await assert.rejects(() => hf.finish(new URL(pendingLogout.url).searchParams.get('state'), 'new-code', pendingLogout.nonce, origin));
        assert.equal(hfExchanges, 1, 'A revoked game session must not exchange an HF code');
    } finally { await db.close(); }
});
