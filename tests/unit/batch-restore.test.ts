import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreIds } from '../../src/shared/history';
import { restoreHistoryResponse } from '../../src/server/statistics';
import { GameRepository } from '../../src/database/repository';
test('batch IDs are bounded, deduplicated positive PostgreSQL bigint strings', () => {
    assert.deepEqual(restoreIds(['1', '1', '9223372036854775807']), ['1', '9223372036854775807']);
    for (const value of [[], ['0'], ['-1'], [1], ['01'], ['9223372036854775808'], ['1;drop'], Array(201).fill('1')]) assert.throws(() => restoreIds(value));
});
test('batch restore rejects cross-origin, unsigned and oversized requests before executing SQL', async () => {
    let calls = 0; const restore = async (ids: string[]) => { calls++; return ids.map(id => ({ id, status: 'restored' as const })); };
    const request = (origin = 'https://game.test', body = '{"ids":["1","1"]}') => new Request('https://game.test/api/stats/videos/restore', { method: 'POST', headers: { origin }, body });
    const config = { AUTH_MODE: 'disabled', AI_PROVIDER: 'mock' };
    assert.equal((await restoreHistoryResponse(request('https://evil.test'), config, restore)).status, 403);
    assert.equal((await restoreHistoryResponse(request(), {}, restore)).status, 401);
    assert.equal((await restoreHistoryResponse(request(undefined, ' '.repeat(8200)), config, restore)).status, 413);
    assert.equal(calls, 0);
    assert.deepEqual(await (await restoreHistoryResponse(request(), config, restore)).json(), { results: [{ id: '1', status: 'restored' }] });
    assert.equal(calls, 1);
});
test('restoration uses one SQL statement, statement-start deadline and existing-round relinking', async () => {
    const queries: string[] = [];
    const repo = new GameRepository({ transaction: async () => {}, query: async statement => { queries.push(statement.text); assert.deepEqual(statement.values, [['1', '2']]); return []; } });
    await repo.restoreVideos(['1', '2']); assert.equal(queries.length, 1);
    assert.match(queries[0], /statement_timestamp\(\)/); assert.doesNotMatch(queries[0], /clock_timestamp/); assert.match(queries[0], /update rounds/);
});
