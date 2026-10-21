import assert from 'node:assert/strict';
import { Client } from 'pg';
import { sqlProfiles } from '../../src/auth/profiles';
import { hashPassword, checkPassword } from '../../src/auth/passwords';
import { sessionResponse, verifyAccountToken, profileAuthConfig } from '../../src/auth/session';
import { GameRepository } from '../../src/database/repository';
import { DATABASE_SCHEMA, PROFILE_SCHEMA } from '../../src/database/schema';
import { prepareRematch } from '../../src/game/participants';
import { gameOptions } from '../../src/game/options';
import type { Room } from '../../src/game/rules';

const url = process.env.TEST_DATABASE_URL;
assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'This test requires an explicit local TEST_DATABASE_URL, never production credentials.');
const client = new Client({ connectionString: url }); await client.connect();
try {
    assert.match((await client.query('show server_version')).rows[0].server_version, /^17\./);
    await client.query('set search_path to pg_temp');
    await client.query(PROFILE_SCHEMA.replace('create table if not exists', 'create temporary table'));
    await client.query("insert into user_profiles (id,name,username_key) values ('legacy-id','Legacy','legacy')");
    const profiles = sqlProfiles(async (text, values) => (await client.query(text, values)).rows);
    const legacy = await profiles.find('Legacy'); assert.equal(legacy?.id, 'legacy-id'); assert.equal(legacy?.authVersion, '0');
    const config = { AUTH_COOKIE_SECRET: 'integration-password-secret-at-least-32-characters' };
    const login = await sessionResponse(new Request('https://game.test/api/session', { method: 'POST', headers: { origin: 'https://game.test' }, body: JSON.stringify({ mode: 'login', username: 'Legacy' }) }), config, profiles);
    const oldSession = await login.json() as any;
    const updated = await profiles.setPassword('legacy-id', await hashPassword('new-legacy-password'));
    assert.equal(updated?.id, 'legacy-id'); assert.notEqual(updated?.authVersion, '0');
    assert.equal(await checkPassword('new-legacy-password', updated!.passwordHash!), true);
    await assert.rejects(verifyAccountToken(oldSession.token, profileAuthConfig(config, profiles)));
    // Run the rest of the additive schema in session-local tables only.
    for (const sql of DATABASE_SCHEMA.slice(1)) await client.query(sql.replace('create table if not exists', 'create temporary table'));
    const repo = new GameRepository({ query: async ({ text, values }) => (await client.query(text, values)).rows,
        transaction: async statements => { await client.query('begin'); try { for (const sql of statements) await client.query(sql.text, sql.values); await client.query('commit'); } catch (error) { await client.query('rollback'); throw error; } } });
    await repo.ensureSchema(); await repo.saveRoom('BATS', 'a', 1);
    for (let i = 1; i <= 3; i++) await repo.saveRound({ roomCode: 'BATS', creatorSocketId: 'a', roundNumber: i, prompt: 'rotate', videoUrl: `/api/videos/videos/1234567890123-${i}.mp4`, roundPoints: 4, votes: [] });
    const ids = (await client.query("select id::text as id from video_history where room_code = 'BATS' order by id")).rows.map(row => row.id as string);
    await client.query("update rounds set video_url = '' where room_code = 'BATS'");
    await client.query(`create function pg_temp.slow_restore() returns trigger language plpgsql as $$ begin if new.delete_after is null then perform pg_sleep(0.25); end if; return new; end $$`);
    await client.query('create trigger slow_restore before update on video_history for each row execute function pg_temp.slow_restore()');
    await client.query("update video_history set delete_after = clock_timestamp() + interval '350 milliseconds' where id = any($1::bigint[])", [ids.slice(0, 2)]);
    await client.query("update video_history set delete_after = clock_timestamp() - interval '1 second' where id = $1", [ids[2]]);
    const start = Date.now(), result = await repo.restoreVideos([...ids, '9223372036854775807']);
    assert.ok(Date.now() - start >= 500, 'The statement must run beyond both individual deadlines.');
    assert.deepEqual(Object.fromEntries(result.map(row => [row.id, row.status])), { [ids[0]]: 'restored', [ids[1]]: 'restored', [ids[2]]: 'expired', '9223372036854775807': 'not_found' });
    assert.equal((await client.query("select count(*)::int as n from rounds where video_url <> ''")).rows[0].n, 2);
    assert.deepEqual((await repo.restoreVideos(ids)).map(r => r.status).sort(), ['expired', 'restored', 'restored']);
    await repo.deleteRoom('BATS');
    assert.equal((await repo.restoreVideos([ids[0]]))[0].status, 'restored'); assert.equal(await repo.roomExists('BATS'), false);
    const old: Room = { code: 'OLD1', hostId: 'p1', players: [{ id: 'p1', accountId: 'legacy-id', name: 'Legacy', sessionId: 'old-session-1', score: 4, connected: true },
        { id: 'p2', accountId: 'friend-id', name: 'Friend', sessionId: 'old-session-2', score: 3, connected: true }], state: 'GAME_OVER', activeCreatorIndex: 1,
        currentVotes: { p1: 3 }, currentRound: 1, maxRounds: 1, currentPrompt: 'Spin', currentVideoUrl: '/assets/mock-video.mp4', options: gameOptions({ requireReady: true }) };
    await repo.saveRoom(old.code, old.hostId, 1); await repo.markRoomStarted(old.code);
    const standings = old.players.map((p, index) => ({ playerSocketId: p.id, name: p.name, score: p.score, finalRank: index + 1 }));
    for (let i = 0; i < 2; i++) await repo.saveRound({ roomCode: old.code, roundNumber: i + 1, creatorSocketId: old.players[i].id, prompt: 'Spin', videoUrl: '/assets/mock-video.mp4', roundPoints: old.players[i].score,
        votes: [{ voterSocketId: old.players[1 - i].id, points: old.players[i].score }], players: old.players, hostId: old.hostId, standings: i ? standings : undefined });
    const history = await repo.getStats('legacy-id');
    const next = prepareRematch(old, 'NEW1').room;
    await repo.saveRoom(next.code, next.hostId, next.maxRounds); await repo.saveScores(next.code, next.players, next.hostId);
    const after = await repo.getStats('legacy-id');
    assert.deepEqual(after.rooms.find(r => r.code === 'OLD1'), history.rooms.find(r => r.code === 'OLD1'));
    assert.deepEqual(after.recentVideos, history.recentVideos);
    assert.equal(after.players.find(p => p.id === 'legacy-id')?.totalScore, 4);
    assert.ok((await client.query("select score from players where room_code = 'NEW1'")).rows.every(p => p.score === 0));
    console.log('PASS: PostgreSQL 17 legacy profile migration, password revocation, atomic slow batch restoration, independent expiry, round relinking, idempotency and detached archives.');
    console.log('PASS: fresh rematch identities and zero scores preserve the previous game, videos, wins and lifetime points in PostgreSQL.');
} finally { await client.end(); }
