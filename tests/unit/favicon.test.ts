import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function assertPng(data: Buffer, size: number) {
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(data.toString('ascii', 12, 16), 'IHDR');
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
}

test('favicon assets have valid browser sizes and are linked from the page', () => {
    const root = path.join(__dirname, '../../public');
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const [name, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]] as const) {
        const file = `/assets/${name}`;
        assert.ok(html.includes(`href="${file}"`));
        assertPng(readFileSync(path.join(root, file)), size);
    }
    assert.ok(html.includes('href="/favicon.ico"'));
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
        assertPng(ico.subarray(offset, offset + bytes), size);
        expectedOffset += bytes;
    }
    assert.equal(expectedOffset, ico.length);
});
