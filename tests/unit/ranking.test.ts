import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranked } from '../../src/shared/ranking';
test('score displays assign shared competition ranks without mutating participants', () => {
    const players = [{ name: 'C', score: 3 }, { name: 'A', score: 6 }, { name: 'B', score: 6 }, { name: 'D', score: 0 }];
    assert.deepEqual(ranked(players, p => p.score).map(({ item, rank }) => [item.name, rank]), [['A', 1], ['B', 1], ['C', 3], ['D', 4]]);
    assert.equal(players[0].name, 'C'); assert.deepEqual(ranked([], () => 0), []);
});
