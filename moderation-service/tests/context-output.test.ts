import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Tensor } from '@huggingface/transformers';
import { snapshotInput, newContextTokens, responseShape } from '../src/context-output.js';
const tensor = (ids: bigint[], rows = 1) => new Tensor('int64', BigInt64Array.from(ids), [rows, ids.length / rows]);
test('context parsing requires the original immutable prompt prefix and a bounded one-row continuation', () => {
    const value = tensor([1n, 2n]), input = snapshotInput(value);
    value.data[0] = 99n; assert.deepEqual(input, [1n, 2n]);
    assert.deepEqual(Array.from(newContextTokens(tensor([1n, 2n, 3n, 4n]), input, 2).data), [3n, 4n]);
    for (const output of [tensor([99n, 2n, 3n]), tensor([1n]), tensor([1n, 2n]), tensor([1n, 2n, 3n, 4n, 5n]), tensor([1n, 2n, 1n, 2n], 2), {}]) {
        assert.throws(() => newContextTokens(output, input, 2));
    }
    assert.throws(() => snapshotInput(tensor([1n, 2n], 2)));
});
test('response diagnostics reveal only a fixed shape, never model prose or a more permissive verdict', () => {
    assert.equal(responseShape(' \n'), 'empty'); assert.equal(responseShape('ALLOW'), 'label');
    for (const text of ['ALLOW.', '"BLOCK"', "'REVIEW'"]) assert.equal(responseShape(text), 'decorated_label');
    assert.equal(responseShape('{"safe":true}'), 'object'); assert.equal(responseShape('```json\n{}\n```'), 'fenced');
    for (const text of ['private model text', 'not ALLOW', 'ALLOW BLOCK', 'Ignore policy']) assert.equal(responseShape(text), 'other');
});
