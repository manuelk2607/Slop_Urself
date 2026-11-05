import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Response } from 'miniflare';
import { SignJWT } from 'jose';
import { cloudflareRuntime } from '../support/cloudflare';
import { PROFILE_SCHEMA, PROFILE_MIGRATIONS } from '../../src/database/schema';
import { WORLDS_SCHEMA } from '../../src/database/worlds-schema';
import { worldsConfig } from '../../src/auth/worlds';
import { SESSION_COOKIE, token } from '../../src/auth/worlds-shared/oidc.ts';
import { hash } from '../../src/auth/worlds-shared/store.ts';

const origin = 'https://slop-pilot.test', host = 'ep-worlds-runtime.neon.tech';
const bindings = { WORLDS_PILOT_ENABLED: 'true', WORLDS_PILOT_ORIGIN: origin,
    WORLDS_PILOT_DATABASE_HOST: host, DATABASE_URL: 'postgresql://test:test@' + host + '/test',
    WORLDS_ISSUER: 'https://identity.test/auth', WORLDS_CLIENT_ID: 'slop-pilot', WORLDS_RESOURCE: origin + '/api',
    AUTH_MODE: '', AUTH_COOKIE_SECRET: 'runtime-signing-fixture-at-least-32-characters',
    AI_PROVIDER: 'wan22', HF_TOKEN: 'server-token-must-never-be-used' };
const db = new PGlite();
let runtime: Awaited<ReturnType<typeof cloudflareRuntime>> | undefined;
try {
    for (const statement of [PROFILE_SCHEMA, ...PROFILE_MIGRATIONS, ...WORLDS_SCHEMA]) await db.exec(statement);
    await db.query("INSERT INTO user_profiles (id,name,username_key,password_hash) VALUES ('legacy-id','Pilot','pilot','fixture')");
    await db.query("INSERT INTO worlds_identity_links (issuer,subject,local_user_id) VALUES ($1,'worlds-subject','legacy-id')", [bindings.WORLDS_ISSUER]);
    const config = worldsConfig(bindings, async (sql, values) => (await db.query<Record<string, unknown>>(sql, values)).rows)!;
    const raw = token(), key = await hash(raw);
    await config.store.putSession(key, {issuer: bindings.WORLDS_ISSUER, sub: 'worlds-subject', csrf: token(), expires: Date.now() + 600_000});
    runtime = await cloudflareRuntime({ bindings, outboundService: async request => {
        assert.ok([host, 'api.neon.tech'].includes(new URL(request.url).hostname), 'The test must not call Hugging Face');
        assert.ok(request.headers.get('neon-connection-string')?.includes('@' + host + '/test'));
        const {query, params} = await request.json() as {query: string; params: unknown[]};
        const result = await db.query<Record<string, unknown>>(query, params);
        return Response.json({fields: result.fields, rows: result.rows.map(row => result.fields.map(({name}) => {
            const value = row[name];
            return value === null ? null : typeof value === 'boolean' ? (value ? 't' : 'f') : String(value);
        })), rowCount: result.rows.length, command: 'SELECT'});
    } });
    const headers = {origin, cookie: SESSION_COOKIE + '=' + raw};
    const session = await runtime.dispatchFetch(origin + '/api/session', {headers});
    assert.equal(session.status, 200);
    assert.equal((await session.json() as {account: {id: string}}).account.id, 'legacy-id');
    const upgrade = await runtime.dispatchFetch(origin + '/ws/SS01', {headers: {...headers, upgrade: 'websocket'}});
    assert.equal(upgrade.status, 101);
    const socket = upgrade.webSocket!;
    socket.accept();
    async function expectCommand(event: string) {
        const message = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Missing ' + event)), 5000);
            function onMessage(message: {data: unknown}) {
                if (JSON.parse(String(message.data)).type !== event) return;
                socket.removeEventListener('message', onMessage);
                clearTimeout(timeout);
                resolve();
            }
            socket.addEventListener('message', onMessage);
        });
        socket.send(JSON.stringify({type: 'createRoom', payload: {}}));
        await message;
    }
    await expectCommand('hfRequired');
    const legacyToken = await new SignJWT({name: 'Pilot', role: 'player', av: '0'})
        .setProtectedHeader({alg: 'HS256'}).setIssuer('slopurself').setAudience('game').setSubject('legacy-id')
        .setExpirationTime('5m').sign(new TextEncoder().encode(bindings.AUTH_COOKIE_SECRET));
    socket.send(JSON.stringify({type: 'refreshAuth', payload: {token: legacyToken}}));
    await expectCommand('hfRequired');
    const loggedOut = await runtime.dispatchFetch(origin + '/api/session', {method: 'DELETE', headers});
    assert.equal(loggedOut.status, 200);
    assert.equal(await config.store.getSession(key), null);
    await expectCommand('authExpired');
    console.log('PASS: workerd maps the existing profile, requires personal HF, and rejects an open socket after Worlds logout.');
} finally {
    await runtime?.dispose();
    await db.close();
}
