import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { Client, Pool } from 'pg';
import { saveRoom, saveScores, saveRound, markRoomStarted, getStats, reopenRoom } from '../db';
import { sqlProfiles } from '../profiles';

dotenv.config({ path: '.env.local', quiet: true });
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for the opt-in database test.');
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
assert.equal(new URL(direct!).hostname.includes('-pooler'), false, 'Temporary-table tests require DATABASE_URL_UNPOOLED (no transaction pooler).');
const client = new Client({ connectionString: direct });
await client.connect();
try {
    // All unqualified SQL is restricted to session-local temporary tables.
    await client.query('set search_path to pg_temp');
    const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')).replaceAll('create table if not exists', 'create temporary table');
    await client.query(schema);
    const profiles = sqlProfiles(async (sql, values) => (await client.query(sql, values)).rows);
    const concurrent = await Promise.all([profiles.create('Friend'), profiles.create(' FRIEND ')]);
    assert.equal(concurrent.filter(Boolean).length, 1, 'The unique DB constraint must reject parallel same-name creations.');
    assert.equal((await profiles.find('friend'))?.id, concurrent[0]?.id);
    assert.equal(await profiles.create('Ｆｒｉｅｎｄ'), undefined, 'Equivalent Unicode spelling must not create another profile.');
    const originals = { query: Pool.prototype.query, connect: Pool.prototype.connect };
    (Pool.prototype as any).query = (...args: any[]) => (client.query as any)(...args);
    (Pool.prototype as any).connect = async () => Object.assign(client, { release() {} });
    try {
        const players = [{ id: 'creator', name: 'Creator', score: 9 }, { id: 'voter', name: 'Voter', score: 0 }];
        await saveRoom('TEST', 'creator', 1);
        await saveRoom('TEST', 'creator', 2);
        assert.equal((await client.query('select max_rounds from rooms where code = $1', ['TEST'])).rows[0].max_rounds, 2, 'Lobby changes must update the persisted round selection.');
        await saveScores('TEST', players, 'creator');
        await markRoomStarted('TEST');
        await saveRoom('TEST', 'creator', 999);
        assert.equal((await client.query('select max_rounds from rooms where code = $1', ['TEST'])).rows[0].max_rounds, 2, 'Started game history must not be overwritten.');
        const input = { roomCode: 'TEST', roundNumber: 1, creatorSocketId: 'creator', prompt: 'wave', videoUrl: 'https://demo.hf.space/video.mp4', roundPoints: 9,
            votes: [{ voterSocketId: 'voter', points: 5 }], players, hostId: 'creator',
            standings: [{ playerSocketId: 'creator', name: 'Creator', score: 9, finalRank: 1 }, { playerSocketId: 'voter', name: 'Voter', score: 0, finalRank: 2 }] };
        await saveRound(input);
        await saveRound(input);
        const stats = await getStats();
        assert.equal(stats.overview.completedGames, 1);
        assert.equal(stats.overview.roundsPlayed, 1);
        assert.equal(stats.overview.votesCast, 1);
        assert.equal(stats.players.find(p => p.name === 'Creator')?.totalScore, 9);
        assert.equal(stats.players.find(p => p.name === 'Creator')?.wins, 1);
        assert.equal(stats.recentVideos[0].creatorName, 'Creator');
        await assert.rejects(saveRound({ ...input, roundNumber: 2, votes: [{ voterSocketId: 'voter', points: null as any }] }));
        assert.equal((await getStats()).overview.roundsPlayed, 1, 'A failed vote insert must roll back the entire round.');
        await reopenRoom('TEST', 3, 'voter');
        const reopened = (await client.query('select status,max_rounds,ended_at,winner_socket_id from rooms where code = $1', ['TEST'])).rows[0];
        assert.equal(reopened.status, 'PLAYING'); assert.equal(reopened.max_rounds, 3); assert.equal(reopened.ended_at, null); assert.equal(reopened.winner_socket_id, null);
        assert.equal((await getStats()).players.find(p => p.name === 'Creator')?.wins, 0);
        assert.equal((await getStats()).players.find(p => p.name === 'Creator')?.totalScore, 9);
        assert.equal((await client.query('select count(*)::int as ranks from players where final_rank is not null')).rows[0].ranks, 0);
        await saveRound({ ...input, roundNumber: 2, roundPoints: 4, players: [{ ...players[0], score: 13 }, players[1]], standings: [{ ...input.standings[0], score: 13 }, input.standings[1]] });
        const extended = await getStats();
        assert.equal(extended.overview.gamesPlayed, 1); assert.equal(extended.overview.completedGames, 1);
        assert.equal(extended.overview.roundsPlayed, 2);
        assert.equal(extended.players.find(p => p.name === 'Creator')?.totalScore, 13);
        assert.equal(extended.players.find(p => p.name === 'Creator')?.wins, 1);
        for (const [code, id, name, score] of [['ACC1', 'account-a', 'SameName', 3], ['ACC2', 'account-a', 'Renamed', 4], ['ACC3', 'account-b', 'SameName', 5]] as const) {
            await saveRoom(code, id, 1); await markRoomStarted(code);
            await saveScores(code, [{ id, accountId: id, name, score }], id);
        }
        const accountStats = (await getStats()).players;
        assert.ok(accountStats.some(player => player.totalScore === 7 && player.gamesPlayed === 2), 'Renaming must retain one account total.');
        assert.ok(accountStats.some(player => player.totalScore === 5 && player.gamesPlayed === 1), 'Identical names on different accounts must not merge.');
        console.log('PASS: PostgreSQL transactions, idempotent round saves, final standings, statistics and rollback; no production rows changed.');
    } finally {
        Pool.prototype.query = originals.query;
        Pool.prototype.connect = originals.connect;
    }
} finally { await client.end(); }
