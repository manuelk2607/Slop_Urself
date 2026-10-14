import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRepository } from '../../src/database/repository';
import { DATABASE_SCHEMA } from '../../src/database/schema';
import { emptyStats, type DatabaseDriver, type SqlStatement } from '../../src/database/types';
import { OVERVIEW_SQL, PLAYERS_SQL, VIDEOS_SQL, VIDEO_CREATORS_SQL, ROOMS_SQL } from '../../src/database/statistics';
import { getDatabase } from '../../src/database/neon';

function fixture() {
    const transactions: SqlStatement[][] = [], queries: SqlStatement[] = [];
    const driver: DatabaseDriver = {
        query: async <T>(query: SqlStatement) => { queries.push(query); return (query.text === OVERVIEW_SQL ? [emptyStats().overview] : []) as T[]; },
        transaction: async statements => { transactions.push(statements); }
    };
    return { repository: new GameRepository(driver), driver, transactions, queries };
}

test('shared repository initializes its schema once across simultaneous operations and retries failures', async () => {
    const f = fixture();
    await Promise.all([f.repository.ensureSchema(), f.repository.saveRoom('TEST', 'host', 2), f.repository.roomExists('TEST')]);
    assert.equal(f.transactions.length, 1);
    assert.deepEqual(f.transactions[0].map(query => query.text), [...DATABASE_SCHEMA]);
    const broken = fixture(); let attempts = 0;
    broken.driver.transaction = async () => { if (++attempts === 1) throw new Error('Database unavailable'); };
    await assert.rejects(broken.repository.ensureSchema());
    await broken.repository.ensureSchema(); assert.equal(attempts, 2);
});

test('round writes batch players and votes in one parameterized transaction regardless of player count', async () => {
    const f = fixture(), prompt = "'; delete from rooms; --";
    const players = Array.from({ length: 10 }, (_, i) => ({ id: `player-${i}`, accountId: `account-${i}`, name: `Friend ${i}`, score: i }));
    await f.repository.saveRound({ roomCode: 'TEST', roundNumber: 3, creatorSocketId: players[0].id,
        prompt, videoUrl: 'https://demo.hf.space/video.mp4', roundPoints: 9, players, hostId: players[0].id,
        votes: players.slice(1).map(p => ({ voterSocketId: p.id, points: 1 })),
        standings: players.map((p, i) => ({ playerSocketId: p.id, name: p.name, score: p.score, finalRank: i + 1 })) });
    const write = f.transactions[1];
    assert.equal(write.length, 4);
    assert.equal(JSON.parse(write[0].values![1] as string).length, 10);
    assert.equal(JSON.parse(write[0].values![1] as string)[0].account, 'account-0');
    assert.equal(JSON.parse(write[0].values![1] as string)[0].rank, 1);
    assert.equal(JSON.parse(write[1].values![6] as string).length, 9);
    assert.ok(write.every(query => !query.text.includes(prompt)));
    assert.equal(write[1].values![3], prompt);
    assert.match(write[2].text, /insert into video_history/);
    assert.deepEqual(write[2].values, ['TEST', 3]);
    assert.deepEqual(write[3].values, ['TEST', 'player-0', 'Friend 0']);
});

test('shared statistics and score batches use the same bounded queries on both runtimes', async () => {
    const f = fixture();
    assert.deepEqual(await f.repository.getStats(), emptyStats());
    assert.deepEqual(f.queries.map(q => q.text), [OVERVIEW_SQL, PLAYERS_SQL, VIDEOS_SQL, VIDEO_CREATORS_SQL, ROOMS_SQL]);
    assert.match(PLAYERS_SQL, /limit 50/); assert.match(VIDEOS_SQL, /limit 12/);
    await f.repository.saveScores('TEST', [{ id: 'a', accountId: 'account', name: 'Friend', score: 5 }, { id: 'b', name: 'Other', score: 3 }], 'a');
    assert.equal(f.queries.length, 6);
    assert.deepEqual(JSON.parse(f.queries[5].values![1] as string), [
        { id: 'a', account: 'account', name: 'Friend', score: 5, host: true },
        { id: 'b', account: null, name: 'Other', score: 3, host: false }
    ]);
});

test('video filtering uses stable account identities and parameterized creator IDs', async () => {
    const f = fixture();
    const id = "account'; delete from rooms; --";
    await f.repository.getStats(id);
    const videoQuery = f.queries.find(query => query.text === VIDEOS_SQL)!;
    assert.deepEqual(videoQuery.values, [id]);
    assert.equal(videoQuery.text.includes(id), false);
    assert.match(PLAYERS_SQL, /pt.player_key as id/);
    assert.match(VIDEOS_SQL, /as "creatorId"/);
});

test('cached Neon repositories get a fresh timeout for every request and transaction', async () => {
    const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
    const controllers: AbortController[] = [];
    const requests: unknown[] = [];
    AbortSignal.timeout = milliseconds => {
        assert.equal(milliseconds, 10_000);
        const controller = new AbortController(); controllers.push(controller);
        return controller.signal;
    };
    globalThis.fetch = async (_url, init) => {
        assert.equal(init?.signal?.aborted, false, 'An earlier request timeout must not cancel this request.');
        const body = JSON.parse(String(init?.body)); requests.push(body);
        const result = { fields: [], rows: [], rowCount: 0, command: 'UPDATE' };
        const response = Response.json(body.queries ? { results: body.queries.map(() => result) } : result);
        controllers.at(-1)!.abort();
        return response;
    };
    try {
        const url = 'postgresql://test:test@ep-fresh-timeout.neon.tech/test';
        const repository = getDatabase(url)!;
        assert.equal(getDatabase(url), repository);
        await repository.saveRoom('TEST', 'host', 1);
        await repository.roomExists('TEST');
        await repository.reopenRoom('TEST', 2, 'host');
        assert.equal(requests.length, 4);
        assert.equal(controllers.length, requests.length);
        assert.equal(getDatabase(), null);
    } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});
