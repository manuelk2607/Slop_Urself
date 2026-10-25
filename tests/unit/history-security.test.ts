import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scopeHistoryQuery } from '../../src/database/access';
import { GameRepository } from '../../src/database/repository';
import { storedProfiles } from '../../src/auth/profiles';
import { sessionResponse } from '../../src/auth/session';
import { historyResponse, restoreHistoryResponse, authorizeHistory, authorizeRestore } from '../../src/server/statistics';

test('history scope filters every relation and binds malicious identity input as a parameter', () => {
    const actor = "viewer');drop table rooms;--";
    const query = scopeHistoryQuery('with totals as (select count(*) from votes) select * from totals', [], actor);
    assert.match(query.text, /with rooms as/); assert.match(query.text, /public\.players/);
    assert.match(query.text, /video_history as/); assert.match(query.text, /, totals as/);
    assert.ok(!query.text.includes(actor)); assert.deepEqual(query.values, [actor]);
    assert.deepEqual(scopeHistoryQuery('select 1', ['unchanged']), { text: 'select 1', values: ['unchanged'] });
});
test('delete and batch restore require object authorization even for a valid owner-proof session', async () => {
    const values = new Map<string, unknown>();
    const profiles = storedProfiles({ get: async <T>(key: string) => values.get(key) as T, put: async (key, value) => { values.set(key, value); } });
    const config = { AUTH_COOKIE_SECRET: 'object-rights-secret-with-at-least-32-characters' };
    const login = await sessionResponse(new Request('https://game.test/api/session', { method: 'POST', headers: { origin: 'https://game.test' }, body: '{"mode":"create","username":"Alice"}' }), config, profiles);
    const cookie = login.headers.getSetCookie()[0].split(';')[0]; let calls = 0;
    const request = (path: string, method: string, body?: string) => new Request('https://game.test' + path, { method, headers: { origin: 'https://game.test', cookie }, body });
    const remove = async () => { calls++; };
    const path = '/api/stats/rooms/TEST';
    assert.equal((await historyResponse(request(path, 'DELETE'), config, remove)).status, 403);
    assert.equal((await historyResponse(request(path, 'DELETE'), config, remove, undefined, async () => false)).status, 403);
    assert.equal(calls, 0);
    assert.equal((await historyResponse(request(path, 'DELETE'), config, remove, undefined, async () => true)).status, 200);
    const restore = async (ids: string[]) => { calls++; return ids.map(id => ({ id, status: 'restored' as const })); };
    const batch = () => request('/api/stats/videos/restore', 'POST', '{"ids":["1","2"]}');
    const denied = await restoreHistoryResponse(batch(), config, restore);
    assert.deepEqual(await denied.json(), { results: [{ id: '1', status: 'forbidden' }, { id: '2', status: 'forbidden' }] });
    assert.equal(calls, 1);
    const allowed = await restoreHistoryResponse(batch(), config, restore, async () => ['1']);
    assert.deepEqual(await allowed.json(), { results: [{ id: '1', status: 'restored' }, { id: '2', status: 'forbidden' }] });
});
test('history ownership uses immutable account IDs, never display names or room codes alone', async () => {
    const account = { id: 'alice', name: 'Alice', expiresAt: Date.now() + 1000, identityProof: 'owner' as const };
    const database = { savedVideo: async () => ({ id: '1', roomCode: 'TEST', creatorId: 'bob' }), canManageRoom: async () => false,
        ownedVideoIds: async () => ['2'] } as unknown as GameRepository;
    assert.equal(await authorizeHistory(database, { code: 'TEST', videoId: '1' }, account, {}), false);
    assert.equal(await authorizeHistory(database, { code: 'TEST' }, account, {}), false);
    assert.equal(await authorizeHistory(database, { code: 'TEST' }, account, { ADMIN_ACCOUNT_ID: 'alice' }), true);
    assert.deepEqual(await authorizeRestore(database, ['1', '2'], account, {}), ['2']);
});
