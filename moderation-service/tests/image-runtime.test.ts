import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { RawImage } from '@huggingface/transformers';

test('patched sharp works with Transformers image decoding without loading model weights', async () => {
    const png = await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 40, g: 120, b: 200 } } }).png().toBuffer();
    const image = await RawImage.fromBlob(new Blob([new Uint8Array(png)], { type: 'image/png' }));
    assert.equal(image.width, 16); assert.equal(image.height, 8);
    const resized = await image.resize(8, 4);
    assert.equal(resized.width, 8); assert.equal(resized.height, 4);
    assert.ok(sharp.versions.vips);
});
