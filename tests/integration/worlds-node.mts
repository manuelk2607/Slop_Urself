import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { worldsConfig } from '../../src/auth/worlds';
import {applyApprovedMigration} from '../../src/auth/worlds-approved';
import { SESSION_COOKIE, token } from '../../src/auth/worlds-shared/oidc.ts';
import { hash } from '../../src/auth/worlds-shared/store.ts';
import { PROFILE_SCHEMA, PROFILE_MIGRATIONS } from '../../src/database/schema';
import { WORLDS_SCHEMA, cleanupWorldsSessions } from '../../src/database/worlds-schema';

const connection = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://invalid.test');
assert.ok(['127.0.0.1', 'localhost'].includes(connection.hostname), 'Worlds QA needs an explicit local PostgreSQL server.');
const dbName = 'slop_worlds_' + crypto.randomUUID().replaceAll('-', '');
const admin = new Client({ connectionString: connection.href });
const directory = await mkdtemp(join(tmpdir(), 'slop-worlds-node-'));
let database: Client | undefined, server: ChildProcess | undefined, created = false;
try {
    await admin.connect();
    await admin.query('CREATE DATABASE ' + dbName);
    created = true;
    connection.pathname = '/' + dbName;
    database = new Client({connectionString: connection.href});
    await database.connect();
    const client = database;
    const query = async (sql: string, values?: unknown[]) => (await client.query(sql, values)).rows;
    for (const statement of [PROFILE_SCHEMA, ...PROFILE_MIGRATIONS, ...WORLDS_SCHEMA]) await query(statement);
    const origin = 'https://slop-node-pilot.test', issuer = 'https://identity.test/auth';
    const env = { WORLDS_PILOT_ENABLED: 'true', WORLDS_PILOT_ORIGIN: origin, WORLDS_TRUST_LOOPBACK_PROXY: 'true',
        WORLDS_PILOT_DATABASE_HOST: connection.hostname, DATABASE_URL: connection.href, WORLDS_ISSUER: issuer,
        WORLDS_CLIENT_ID: 'slop-node-pilot', WORLDS_RESOURCE: origin + '/api', AI_PROVIDER: 'wan22',
        AUTH_COOKIE_SECRET: 'node-worlds-integration-fixture-only' };
    const worlds = worldsConfig(env, query)!;
    const raw = token(), key = await hash(raw), now = Date.now();
    await query("INSERT INTO user_profiles (id,name,username_key,password_hash) VALUES ('local-id','Pilot','pilot','fixture')");
    await query("INSERT INTO worlds_identity_links (issuer,subject,local_user_id) VALUES ($1,'worlds-subject','local-id')", [issuer]);
    await worlds.store.putSession(key, {issuer, sub: 'worlds-subject', csrf: token(), expires: now + 600_000});
    await query("INSERT INTO worlds_auth_sessions (id,issuer,subject,payload,expires) VALUES ('expired',$1,'old','{}',$2)", [issuer, now - 1]);
    await query("INSERT INTO worlds_auth_transactions (id,payload,expires) VALUES ('expired','{}',$1),('active','{}',$2)", [now - 1, now + 60_000]);
    await query("INSERT INTO worlds_auth_replays SELECT 'old-' || generate_series(1,251),$1", [now - 1]);
    await query("INSERT INTO worlds_auth_replays VALUES ('active',$1)", [now + 60_000]);
    await cleanupWorldsSessions(query, now);
    assert.deepEqual(await query('SELECT id FROM worlds_auth_transactions'), [{id: 'active'}]);
    assert.deepEqual(await query('SELECT id FROM worlds_auth_sessions'), [{id: key}]);
    assert.equal((await query('SELECT id FROM worlds_auth_replays')).length, 2);
    await cleanupWorldsSessions(query, now);
    assert.deepEqual(await query('SELECT id FROM worlds_auth_replays'), [{id: 'active'}]);

    // Two independent PostgreSQL connections must consume one reviewed approval once.
    const approval=crypto.randomUUID();
    await query("INSERT INTO user_profiles(id,name,username_key) VALUES('reviewed-id','Reviewed','reviewed')");
    await query(`INSERT INTO worlds_migration_approvals(id,issuer,subject,local_user_id,source_auth_version,approved_by,approval_ref,expires_at)
        VALUES($1,$2,'reviewed-subject','reviewed-id','0','project-owner','concurrent-fixture',now()+interval '1 hour')`,[approval,issuer]);
    const competing=new Client({connectionString:connection.href});await competing.connect();
    try{
        const other=async(sql:string,values?:unknown[])=>(await competing.query(sql,values)).rows;
        const results=await Promise.all([applyApprovedMigration(query,approval),applyApprovedMigration(other,approval)]);
        assert.deepEqual(results.sort(),[false,true]);
        assert.deepEqual(await query("SELECT local_user_id FROM worlds_identity_links WHERE subject='reviewed-subject'"),[{local_user_id:'reviewed-id'}]);
        assert.equal((await query("SELECT count(*)::int AS n FROM worlds_link_audit WHERE subject='reviewed-subject'"))[0].n,1);
        assert.equal((await query("SELECT auth_version FROM user_profiles WHERE id='reviewed-id'"))[0].auth_version,'0');
        await query("DELETE FROM worlds_identity_links WHERE subject='reviewed-subject'");
        await query('DELETE FROM worlds_migration_approvals WHERE id=$1',[approval]);
        await query("DELETE FROM worlds_link_audit WHERE subject='reviewed-subject'");
        await query("DELETE FROM user_profiles WHERE id='reviewed-id'");
        console.log('PASS PostgreSQL concurrent reviewed passwordless migration is one-use and rollback preserves the source profile');
    }finally{await competing.end();}

    const probe = createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const {port} = probe.address() as AddressInfo;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    server = spawn(process.execPath, ['--import', fileURLToPath(import.meta.resolve('tsx')),
        fileURLToPath(new URL('../../src/server/node.ts', import.meta.url))],
    {cwd: directory, env: {...env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe']});
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Local Node startup timed out')), 10_000);
        server!.once('exit', () => { clearTimeout(timeout); reject(new Error('Local Node exited during startup')); });
        server!.stdout!.on('data', (data: Buffer) => {
            if (data.toString().includes('Server läuft')) { clearTimeout(timeout); resolve(); }
        });
        server!.stderr!.resume();
    });
    const root = 'http://127.0.0.1:' + port;
    const headers = {host: new URL(origin).host, origin, 'x-forwarded-proto': 'https', cookie: SESSION_COOKIE + '=' + raw};
    async function request(path: string, method = 'GET', body?: string) {
        return new Promise<Response>((resolve, reject) => {
            const req = httpRequest(root + path, {method, headers: {...headers, 'content-type': 'text/plain'},
                signal: AbortSignal.timeout(5000)}, res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: res.statusCode})));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end(body);
        });
    }
    const session = await request('/api/session');
    assert.equal(session.status, 200);
    assert.equal((await session.json() as {account: {id: string}}).account.id, 'local-id');
    const polling = '/socket.io/?EIO=4&transport=polling';
    const handshake = await (await request(polling)).text();
    assert.match(handshake, /^0\{/);
    const {sid} = JSON.parse(handshake.slice(1)) as {sid: string};
    const transport = polling + '&sid=' + encodeURIComponent(sid);
    assert.equal((await request(transport, 'POST', '40')).status, 200);
    assert.match(await (await request(transport)).text(), /^40/);
    const command = '42["createRoom",{}]';
    assert.equal((await request(transport, 'POST', command)).status, 200);
    assert.match(await (await request(transport)).text(), /"hfRequired"/);
    assert.equal((await request('/api/session', 'DELETE')).status, 200);
    assert.equal((await request(transport, 'POST', command)).status, 200);
    assert.match(await (await request(transport)).text(), /"authExpired"/);
    assert.equal(await worlds.store.getSession(key), null);
    console.log('PASS: PostgreSQL 17 cleanup, Node HTTPS proxy login, Socket.IO HF gate and logout revocation.');
} finally {
    if (server && server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        await exited;
    }
    await database?.end();
    if (created) await admin.query('DROP DATABASE ' + dbName);
    await admin.end();
    await rm(directory, {recursive: true, force: true});
}
