import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { GameRepository } from '../../src/database/repository';
import { deleteStoredHistory, purgeDeletedVideos } from '../../src/server/statistics';

dotenv.config({ path: '.env.local', quiet: true });
const source = new URL(process.env.DATABASE_URL_UNPOOLED!);
const host = process.argv[2];
assert.match(host, /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/);
assert.notEqual(host, source.hostname, 'This test must never run on production.');
assert.equal(host.includes('-pooler'), false);
source.hostname = host;
const client = new Client({ connectionString: source.href });
await client.connect();
try {
    const driver = {
        query: async <T>({ text, values }: { text: string; values?: unknown[] }) => (await client.query(text, values)).rows as T[],
        transaction: async (statements: { text: string; values?: unknown[] }[]) => {
            await client.query('begin');
            try { for (const item of statements) await client.query(item.text, item.values); await client.query('commit'); }
            catch (error) { await client.query('rollback'); throw error; }
        }
    };
    const expected = (await client.query("select count(*)::int as n from rounds where video_url <> ''")).rows[0].n;
    const database = new GameRepository(driver);
    await database.ensureSchema();
    assert.equal((await client.query("select count(*)::int as n from video_history where video_url <> ''")).rows[0].n, expected);
    let stats = await database.getStats();
    if (!stats.recentVideos.length) {
        const code = 'MGRT';
        assert.equal(await database.roomExists(code), false);
        // Exercise the legacy backfill even when production currently has no saved videos.
        await client.query("insert into rooms (code, host_socket_id, max_rounds, status, started_at) values ($1, 'migration-author', 1, 'GAME_OVER', now())", [code]);
        await client.query("insert into players (room_code, socket_id, name, score, account_id) values ($1, 'migration-author', 'MigrationFriend', 5, 'migration-account')", [code]);
        await client.query("insert into rounds (room_code, round_number, creator_socket_id, prompt, video_url, round_points) values ($1, 1, 'migration-author', 'Legacy video', '/assets/mock-video.mp4', 5)", [code]);
        await new GameRepository(driver).ensureSchema();
        stats = await database.getStats();
    }
    assert.ok(stats.recentVideos.length > 0);
    const original = stats.recentVideos[0];
    const schedule = async (_time: number) => {};
    await deleteStoredHistory(database, { code: original.roomCode }, schedule);
    const retained = await database.savedVideo(original.id);
    assert.equal(retained?.videoUrl, original.videoUrl); assert.equal(retained?.creatorName, original.creatorName);
    assert.equal(retained?.prompt, original.prompt); assert.equal(retained?.roomDeleted, true);
    assert.equal(await database.roomExists(original.roomCode), false);
    await database.saveRoom(original.roomCode, 'new-host', 1);
    await database.markRoomStarted(original.roomCode);
    const input = { roomCode: original.roomCode, roundNumber: original.roundNumber, creatorSocketId: 'new-host',
        prompt: 'New game, independent video', videoUrl: '/assets/mock-video.mp4', roundPoints: 2, votes: [],
        players: [{ id: 'new-host', accountId: 'new-account', name: 'NewFriend', score: 2 }], hostId: 'new-host' };
    await database.saveRound(input);
    const current = (await database.getStats('new-account')).recentVideos[0];
    assert.notEqual(current.id, original.id);
    assert.equal((await database.savedVideo(original.id))?.roomDeleted, true, 'Reusing a room code must not attach an old video to a new game.');
    const command = { code: original.roomCode, roundNumber: original.roundNumber, videoId: original.id };
    await deleteStoredHistory(database, command, schedule);
    await deleteStoredHistory(database, { ...command, restore: true }, schedule);
    assert.equal((await database.savedVideo(original.id))?.videoUrl, original.videoUrl);
    assert.equal((await database.savedVideo(current.id))?.videoUrl, input.videoUrl);
    const newCommand = { code: current.roomCode, roundNumber: current.roundNumber, videoId: current.id };
    await deleteStoredHistory(database, newCommand, schedule);
    const deleted: string[] = [];
    await client.query("update video_history set delete_after = clock_timestamp() - interval '1 second' where id = $1", [current.id]);
    await assert.rejects(deleteStoredHistory(database, { ...newCommand, restore: true }, schedule), /Frist/);
    await purgeDeletedVideos(database, async url => { deleted.push(url); });
    assert.deepEqual(deleted, [input.videoUrl]);
    await database.saveRound(input);
    await new GameRepository(driver).ensureSchema();
    assert.equal(await database.savedVideo(current.id), undefined, 'Delayed writes and migration replays must not resurrect purged videos.');
    assert.equal((await database.savedVideo(original.id))?.videoUrl, original.videoUrl);
    console.log('PASS: migration/backfill on an isolated production clone, independent metadata, room-code reuse, undo/expiry and no resurrection. Only the test branch changed; no storage objects were touched.');
} finally { await client.end(); }
