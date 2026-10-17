import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { testImage, testImageData } from '../support/images';

test('browser upload fixtures have valid PNG chunks, checksums and complete pixel data', () => {
    for (const [width, height] of [[320, 240], [624, 832], [640, 640]]) {
        const bytes = testImage(width, height);
        const decoded = PNG.sync.read(bytes, { checkCRC: true });
        assert.equal(decoded.width, width); assert.equal(decoded.height, height);
        assert.equal(decoded.data.length, width * height * 4);
        assert.deepEqual([...decoded.data.subarray(0, 4)], [200, 80, 110, 255]);
        assert.deepEqual(Buffer.from(testImageData(width, height).split(',')[1], 'base64'), bytes);
    }
});
