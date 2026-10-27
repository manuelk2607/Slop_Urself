import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureContextImages } from '../src/preprocessing.js';
test('bounded context processing retains tile inspection and rejects unreviewed preprocessing defaults', () => {
    const processor = { size: { longest_edge: 2048 }, max_image_size: { longest_edge: 512 }, do_image_splitting: true };
    configureContextImages(processor);
    assert.deepEqual(processor.size, { longest_edge: 1024 });
    assert.equal(processor.do_image_splitting, true);
    assert.throws(() => configureContextImages(undefined), /Unreviewed/);
    for (const changed of [{ size: { longest_edge: 4096 } }, { do_image_splitting: false }, { max_image_size: { longest_edge: 256 } }]) {
        assert.throws(() => configureContextImages({ ...processor, size: { longest_edge: 2048 }, ...changed }), /Unreviewed/);
    }
});
