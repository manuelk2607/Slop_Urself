import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { Client, Pool } from 'pg';
import { saveRoom, saveScores, saveRound, markRoomStarted, getStats, reopenRoom, getDatabase } from '../../src/database/node';
import { deleteStoredHistory, purgeDeletedVideos } from '../../src/server/statistics';
import { sqlProfiles } from '../../src/auth/profiles';
import { profileAuthConfig, sessionResponse, verifyAccountToken } from '../../src/auth/session';
import { DATABASE_SCHEMA } from '../../src/database/schema';
import { COPY_VIDEO_HISTORY_SQL } from '../../src/database/video-history';
import { historyCursor } from '../../src/database/pagination';

dotenv.config({ path: '.env.local', quiet: true });
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for the opt-in database test.');
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
assert.equal(new URL(direct!).hostname.includes('-pooler'), false, 'Temporary-table tests require DATABASE_URL_UNPOOLED (no transaction pooler).');
const client = new Client({ connectionString: direct });
await client.connect();
try {
    // All unqualified SQL is restricted to session-local temporary tables.
    await client.query('set search_path to pg_temp');
    const schema = DATABASE_SCHEMA.join(';\n').replaceAll('create table if not exists', 'create temporary table');
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
        assert.equal((await getStats('legacy:creator')).recentVideos.length, 2);
        assert.equal((await getStats('account-b')).recentVideos.length, 0);
        const deletionPlayers = [{ id: 'creator', accountId: 'delete-creator', name: 'DeleteCreator', score: 9 },
            { id: 'voter', accountId: 'delete-voter', name: 'DeleteVoter', score: 0 }];
        await saveRoom('DELT', 'creator', 1); await markRoomStarted('DELT');
        const firstUrl = '/api/videos/videos/1234567890123-first.mp4';
        const secondUrl = '/api/videos/videos/1234567890123-second.mp4';
        await saveRound({ ...input, roomCode: 'DELT', players: deletionPlayers, videoUrl: firstUrl });
        await saveRound({ ...input, roomCode: 'DELT', roundNumber: 2, players: deletionPlayers, videoUrl: secondUrl });
        const deletedFiles: string[] = [];
        const removeFile = async (url: string) => { deletedFiles.push(url); };
        await assert.rejects(deleteStoredHistory(getDatabase(), { code: 'DELT', roundNumber: 1 }, async () => { throw new Error('Scheduler down'); }));
        assert.equal((await getStats('delete-creator')).recentVideos.length, 2, 'Scheduler failures must not hide or delete a video.');
        const schedule = async (_time: number) => {};
        const originalVideos = (await getStats('delete-creator')).recentVideos;
        const firstVideo = originalVideos.find(video => video.roundNumber === 1)!;
        const deletion = await deleteStoredHistory(getDatabase(), { code: 'DELT', roundNumber: 1, videoId: firstVideo.id }, schedule);
        assert.ok(deletion.undoUntil! > Date.now());
        assert.ok((await getDatabase()!.protectedVideoUrls()).includes(firstUrl), 'A video inside its undo window must be protected from automatic eviction.');
        assert.equal((await getStats('delete-creator')).recentVideos.length, 1);
        assert.equal((await getStats()).players.find(player => player.id === 'delete-creator')?.totalScore, 9);
        assert.equal((await client.query('select count(*)::int as n from votes v join rounds r on r.id = v.round_id where r.room_code = $1', ['DELT'])).rows[0].n, 2);
        const profilesBefore = (await client.query('select count(*)::int as n from user_profiles')).rows[0].n;
        await deleteStoredHistory(getDatabase(), { code: 'DELT' }, schedule);
        assert.deepEqual(deletedFiles, [], 'Deleting a room must not remove any video file.');
        for (const table of ['rooms', 'players', 'rounds']) {
            const column = table === 'rooms' ? 'code' : 'room_code';
            assert.equal((await client.query(`select count(*)::int as n from ${table} where ${column} = $1`, ['DELT'])).rows[0].n, 0);
        }
        assert.equal((await getStats()).players.some(player => player.id === 'delete-creator'), false);
        const retained = await getStats('delete-creator');
        assert.equal(retained.recentVideos.length, 1);
        assert.equal(retained.recentVideos[0].roomDeleted, true);
        assert.equal(retained.recentVideos[0].creatorName, 'DeleteCreator');
        assert.equal(retained.videoCreators.some(creator => creator.id === 'delete-creator'), true);
        await deleteStoredHistory(getDatabase(), { code: 'DELT', roundNumber: 1, videoId: firstVideo.id, restore: true }, schedule);
        assert.equal((await getDatabase()!.protectedVideoUrls()).includes(firstUrl), false);
        assert.equal((await getStats('delete-creator')).recentVideos.length, 2, 'Undo must work even if its former room was deleted.');
        assert.equal(await getDatabase()!.roomExists('DELT'), false, 'Undo must not recreate the deleted room.');
        await deleteStoredHistory(getDatabase(), { code: 'DELT', roundNumber: 1, videoId: firstVideo.id }, schedule);
        await client.query("update video_history set delete_after = clock_timestamp() - interval '1 second' where id = $1", [firstVideo.id]);
        await assert.rejects(deleteStoredHistory(getDatabase(), { code: 'DELT', roundNumber: 1, videoId: firstVideo.id, restore: true }, schedule), /Frist/);
        await purgeDeletedVideos(getDatabase(), removeFile);
        assert.deepEqual(deletedFiles, [firstUrl]);
        assert.equal(await getDatabase()!.savedVideo(firstVideo.id), undefined);
        assert.equal((await getStats('delete-creator')).recentVideos[0].videoUrl, secondUrl);
        assert.equal((await client.query('select count(*)::int as n from user_profiles')).rows[0].n, profilesBefore);
        const retired = (await profiles.create('Retired'))!;
        const auth = profileAuthConfig({ AUTH_COOKIE_SECRET: 'integration-session-secret-at-least-32-characters' }, profiles);
        const login = await sessionResponse(new Request('https://game.test/api/session', { method: 'POST', headers: { origin: 'https://game.test' }, body: JSON.stringify({ mode: 'login', username: retired.name }) }), auth, profiles);
        const { token } = await login.json() as { token: string };
        await saveRoom('KEEP', 'retired-player', 1); await markRoomStarted('KEEP');
        await saveRound({ ...input, roomCode: 'KEEP', creatorSocketId: 'retired-player', hostId: 'retired-player', players: [{ id: 'retired-player', accountId: retired.id, name: retired.name, score: 9 }], votes: [], standings: [] });
        assert.equal((await profiles.list()).some(profile => profile.id === retired.id), true);
        assert.equal((await profiles.remove(retired.id))?.id, retired.id);
        await assert.rejects(verifyAccountToken(token, auth), /gelöscht/);
        const kept = await getStats(retired.id);
        assert.equal(kept.players.find(player => player.id === retired.id)?.totalScore, 9);
        assert.equal(kept.recentVideos.length, 1, 'Deleting an account must not remove its historical videos or scores.');
        const replacement = (await profiles.create(retired.name))!;
        assert.notEqual(replacement.id, retired.id);
        await assert.rejects(verifyAccountToken(token, auth), /gelöscht/);
        assert.equal(await profiles.remove('nonexistent'), undefined);
        await client.query(`insert into rooms (code, host_socket_id, max_rounds, status, started_at, created_at)
            select 'P' || lpad(i::text, 3, '0'), 'pager', 1, 'GAME_OVER', now(), '2026-10-14T12:00:00.123456Z' from generate_series(1, 55) i`);
        await client.query(`insert into players (room_code, socket_id, name, account_id, score)
            select code, 'pager', 'Pager', 'page-friend', 5 from rooms where code like 'P%'`);
        await client.query(`insert into rounds (room_code, round_number, creator_socket_id, prompt, video_url, round_points, created_at)
            select 'P' || lpad(i::text, 3, '0'), 1, 'pager', 'Keep this prompt', '/api/videos/videos/1234567890123-page-' || i || '.mp4', 5,
                '2026-10-14T12:00:00.123456Z' from generate_series(1, 31) i`);
        await client.query(`${COPY_VIDEO_HISTORY_SQL} on conflict (id) do nothing`);
        const repository = getDatabase()!;
        const first = await repository.getStats('page-friend');
        assert.equal(first.recentVideos.length, 12); assert.ok(first.videoCursor); assert.ok(first.roomCursor);
        const allVideos = [...first.recentVideos]; let cursor = first.videoCursor;
        while (cursor) { const page = await repository.videoPage('page-friend', historyCursor(cursor, 'videos')); allVideos.push(...page.items); cursor = page.nextCursor; }
        assert.equal(allVideos.length, 31); assert.equal(new Set(allVideos.map(video => video.id)).size, 31);
        const allRooms = [...first.rooms]; cursor = first.roomCursor;
        while (cursor) { const page = await repository.roomPage(historyCursor(cursor, 'rooms')); allRooms.push(...page.items); cursor = page.nextCursor; }
        assert.equal(allRooms.length, (await client.query('select count(*)::int as n from rooms')).rows[0].n);
        assert.equal(new Set(allRooms.map(room => room.code)).size, allRooms.length);
        const removed = first.recentVideos[0], overviewBefore = first.overview.videosArchived;
        const existingUrls = (await client.query("select video_url from video_history where video_url <> ''")).rows.map(row => row.video_url as string);
        await repository.reconcileArchive(existingUrls.filter(url => url !== removed.videoUrl));
        const afterEviction = await repository.getStats('page-friend');
        assert.equal(afterEviction.overview.videosArchived, overviewBefore - 1);
        assert.ok(afterEviction.recentVideos.find(video => video.id === removed.id)?.evictedAt);
        assert.equal(afterEviction.recentVideos[0].prompt, 'Keep this prompt');
        assert.equal(afterEviction.players.find(player => player.id === 'page-friend')?.totalScore, first.players.find(player => player.id === 'page-friend')?.totalScore);
        assert.equal(afterEviction.rooms.find(room => room.code === removed.roomCode)?.videoCount, 0);
        await repository.saveRound({ roomCode: removed.roomCode, roundNumber: 1, creatorSocketId: 'pager', prompt: 'Delayed write', videoUrl: removed.videoUrl, roundPoints: 5, votes: [] });
        assert.ok((await repository.savedVideo(removed.id))?.evictedAt, 'A delayed round write must not revive an evicted file.');
        assert.equal((await repository.savedVideo(removed.id))?.prompt, 'Keep this prompt');
        // Exercise the additive migration against a legacy table as well as a fresh schema.
        const historyCount = (await client.query('select count(*)::int as n from video_history')).rows[0].n;
        await client.query('alter table video_history drop column evicted_at');
        await client.query(DATABASE_SCHEMA.find(sql => sql.startsWith('alter table video_history add column'))!);
        assert.equal((await client.query('select count(*)::int as n from video_history')).rows[0].n, historyCount);
        console.log('PASS: keyset history pagination across timestamp ties, creator filters, archive reconciliation preserving points/prompts and additive legacy schema migration.');
        console.log('PASS: PostgreSQL transactions, idempotent round saves, final standings, statistics and rollback; no production rows changed.');
    } finally {
        Pool.prototype.query = originals.query;
        Pool.prototype.connect = originals.connect;
    }
} finally { await client.end(); }
