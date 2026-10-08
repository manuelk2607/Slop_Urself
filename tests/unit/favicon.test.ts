import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function assertPng(data: Buffer, size: number) {
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(data.toString('ascii', 12, 16), 'IHDR');
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
    assert.equal(data[24], 8);
    assert.equal(data[25], 6, 'Icons use true-color RGBA, not indexed-color PNG.');
}

test('favicon assets have valid browser sizes and are linked from the page', () => {
    const root = path.join(__dirname, '../../public');
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const [file, size] of [['/assets/favicon-32.png', 32], ['/apple-touch-icon.png', 180]] as const) {
        assert.ok(html.includes(`href="${file}?v=3"`));
        assertPng(readFileSync(path.join(root, file)), size);
    }
    assert.deepEqual(readFileSync(path.join(root, 'apple-touch-icon.png')), readFileSync(path.join(root, 'assets/apple-touch-icon.png')));
    assert.ok(html.includes('type="image/x-icon" href="/favicon.ico?v=3"'));
    assert.ok(html.includes('rel="apple-touch-icon-precomposed" href="/apple-touch-icon-precomposed.png?v=3"'));
    const ico = readFileSync(path.join(root, 'favicon.ico'));
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    let expectedOffset = 54;
    for (const [index, size] of [16, 32, 48].entries()) {
        const entry = 6 + index * 16;
        assert.equal(ico[entry], size);
        assert.equal(ico[entry + 1], size);
        assert.equal(ico.readUInt16LE(entry + 4), 1);
        assert.equal(ico.readUInt16LE(entry + 6), 32);
        const bytes = ico.readUInt32LE(entry + 8);
        const offset = ico.readUInt32LE(entry + 12);
        assert.equal(offset, expectedOffset);
        const dib = ico.subarray(offset, offset + bytes);
        const pixelBytes = size * size * 4;
        const maskBytes = Math.ceil(size / 32) * 4 * size;
        assert.equal(bytes, 40 + pixelBytes + maskBytes);
        assert.equal(dib.readUInt32LE(0), 40, 'ICO uses a classic BITMAPINFOHEADER.');
        assert.equal(dib.readInt32LE(4), size);
        assert.equal(dib.readInt32LE(8), size * 2);
        assert.equal(dib.readUInt16LE(12), 1);
        assert.equal(dib.readUInt16LE(14), 32);
        assert.equal(dib.readUInt32LE(16), 0);
        for (let pixel = 40; pixel < 40 + pixelBytes; pixel += 4) assert.equal(dib[pixel + 3], 255);
        assert.ok(dib.subarray(40 + pixelBytes).every(byte => byte === 0));
        expectedOffset += bytes;
    }
    assert.equal(expectedOffset, ico.length);
});

test('Cloudflare must not serve the game HTML for missing icon or asset paths', () => {
    const config = readFileSync(path.join(__dirname, '../../cloudflare/wrangler.toml'), 'utf8');
    assert.match(config, /^not_found_handling\s*=\s*"none"\s*$/m);
});
