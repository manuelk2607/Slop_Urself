import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { encode } from 'jpeg-js';
import { normalizeImage } from '../../src/security/images';
import { moderateInput, moderateOutput, generationSafetyReady, validatePrompt } from '../../src/security/moderation';
import { testImage, testImageData } from '../support/images';
import { testModerationConfig, moderationFixture } from '../support/moderation-fixture';

test('image validation decodes pixels, flattens transparency and rejects incomplete/corrupt/oversized PNG/JPEG', async () => {
    const png = new PNG({ width: 2, height: 2 }); png.data.fill(0);
    const normalized = await normalizeImage(`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`);
    const decoded = PNG.sync.read(Buffer.from(normalized.split(',')[1], 'base64'));
    assert.deepEqual([...decoded.data.subarray(0, 4)], [255, 255, 255, 255]);
    const jpeg = encode({ width: 2, height: 2, data: Buffer.alloc(16, 255) });
    assert.match(await normalizeImage(`data:image/jpeg;base64,${jpeg.data.toString('base64')}`), /^data:image\/png/);
    const truncated = testImage(832, 624).subarray(0, 33);
    await assert.rejects(normalizeImage(`data:image/png;base64,${truncated.toString('base64')}`));
    const corrupt = testImage(32, 32); corrupt[40] ^= 255;
    await assert.rejects(normalizeImage(`data:image/png;base64,${corrupt.toString('base64')}`));
    await assert.rejects(normalizeImage(testImageData(1024, 1024)));
    await assert.rejects(normalizeImage(`data:image/jpeg;base64,${jpeg.data.subarray(0, 20).toString('base64')}`));
    const canonical = await normalizeImage(testImageData(32, 24));
    assert.equal(await normalizeImage(canonical), canonical);
});
test('real moderation fails closed before any request without reviewed configuration', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('No request allowed'); };
    try {
        assert.throws(() => generationSafetyReady({ AI_PROVIDER: 'wan22' }), /Inhaltsprüfung/);
        await assert.rejects(moderateInput('image', 'wave', { AI_PROVIDER: 'wan22' }), /Inhaltsprüfung/);
        await assert.rejects(moderateInput('image', 'wave', { ...testModerationConfig, MODERATION_URL: 'http://unsafe.test' }), /Inhaltsprüfung/);
        assert.equal(calls, 0);
        for (const value of ['', 'x'.repeat(151), 'test\u200b']) assert.throws(() => validatePrompt(value));
        assert.equal(validatePrompt('  Harmloses Familienbild animieren  '), 'Harmloses Familienbild animieren');
    } finally { globalThis.fetch = original; }
});
test('moderation requires content-bound complete verdicts and rejects review, malformed results and partial video checks', async () => {
    const original = globalThis.fetch;
    let patch: Record<string, unknown> = {};
    globalThis.fetch = async (input, init) => {
        const fixture = moderationFixture(input, init)!;
        return Response.json({ ...await fixture.json() as object, ...patch });
    };
    try {
        for (const invalid of [{ decision: 'review' }, { decision: 'block' }, { decision: 'unknown' }, { digest: 'wrong' }, { decodeComplete: false }, { evaluationOnly: true }]) {
            patch = invalid; await assert.rejects(moderateInput('image', JSON.stringify(invalid), testModerationConfig));
        }
        for (const invalid of [{ framesChecked: 1 }, { codec: 'hevc' }, { durationSeconds: 2 }, { frameCount: 0 }]) {
            patch = invalid; await assert.rejects(moderateOutput(new TextEncoder().encode(JSON.stringify(invalid)), testModerationConfig));
        }
        patch = {}; await moderateInput('image', 'benign-protocol-fixture', testModerationConfig);
        await moderateOutput(new TextEncoder().encode('complete-output-fixture'), testModerationConfig);
    } finally { globalThis.fetch = original; }
});
