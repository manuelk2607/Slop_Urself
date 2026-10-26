import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveVideo } from '../../src/storage/archive';
test('archive errors identify download, moderation, inventory and storage without leaking remote errors or URLs', async () => {
    const originalFetch = globalThis.fetch, originalInfo = console.info, logs: string[] = [];
    let stage = 'download';
    const bytes = Uint8Array.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
    const config = { AWS_ACCESS_KEY_ID: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture', AWS_ENDPOINT_URL_S3: 'https://storage.test', AI_PROVIDER: 'mock' };
    const artifact = { generationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', submittedAt: 1792000000000, releaseId: 'a'.repeat(40) };
    console.info = value => logs.push(String(value));
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url.includes('.hf.space')) {
            if (stage === 'download') throw new Error('private-token private-prompt');
            return new Response(bytes);
        }
        if (request.url.includes('list-type') && stage !== 'inventory') return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
        return new Response('private-token private-prompt', { status: 403 });
    };
    try {
        for (stage of ['download', 'output_moderation', 'inventory', 'archive']) {
            await assert.rejects(archiveVideo('https://fixture.hf.space/video.mp4?private-token=secret', { ...config, AI_PROVIDER: stage === 'output_moderation' ? 'wan22' : 'mock' }, [], undefined, 'TEST', artifact));
            const entry = JSON.parse(logs.at(-1)!);
            assert.equal(entry.event, 'archive_failed'); assert.equal(entry.stage, stage);
            assert.equal(entry.generationId, artifact.generationId); assert.equal(entry.releaseId, artifact.releaseId);
        }
        assert.doesNotMatch(logs.join(''), /private|secret|https|prompt/);
        const count = logs.length;
        await assert.rejects(archiveVideo('https://fixture.hf.space/video.mp4', config, [], undefined, 'private-prompt', artifact));
        assert.equal(logs.length, count, 'Invalid caller metadata must not enter logs.');
    } finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
});
