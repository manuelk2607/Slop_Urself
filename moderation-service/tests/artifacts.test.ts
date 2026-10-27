import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureArtifact, ensureModelArtifacts } from '../src/artifacts.js';
test('pinned artifact hashes reject truncated or altered cache; failed downloads cannot replace it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slop-model-integrity-')), original = globalThis.fetch;
    const bytes = Buffer.from('public artifact fixture, not an ONNX model');
    const model = { id: 'test/model', revision: 'a'.repeat(40) };
    const file = { path: 'onnx/model.onnx', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const target = join(root, model.id, model.revision, file.path); let calls = 0;
    try {
        await mkdir(dirname(target), { recursive: true }); await writeFile(target, 'partial');
        await assert.rejects(ensureArtifact(model, file, root), /integrity failed/);
        globalThis.fetch = async (_input, options) => { calls++; assert.equal(new Headers(options?.headers).has('authorization'), false); return new Response('incomplete'); };
        await assert.rejects(ensureArtifact(model, file, root, true), /integrity failed/);
        assert.equal(await readFile(target, 'utf8'), 'partial');
        assert.deepEqual(await readdir(dirname(target)), ['model.onnx']);
        globalThis.fetch = async () => { calls++; return new Response(bytes); };
        assert.equal(await ensureArtifact(model, file, root, true), 'downloaded');
        assert.equal(await ensureArtifact(model, file, root), 'cached'); assert.equal(calls, 2);
        const altered = Buffer.from(bytes); altered[0] ^= 1; await writeFile(target, altered);
        await assert.rejects(ensureArtifact(model, file, root), /integrity failed/);
    } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});
test('model repair rejects path traversal, untrusted redirects and missing manifests before loading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slop-model-boundary-')), original = globalThis.fetch;
    const model = { id: 'test/model', revision: 'a'.repeat(40) };
    const file = { path: 'onnx/model.onnx', bytes: 10, sha256: 'b'.repeat(64) };
    try {
        await assert.rejects(ensureArtifact(model, { ...file, path: '../../secret' }, root, true), /Invalid/);
        globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://untrusted.test/private' } });
        await assert.rejects(ensureArtifact(model, file, root, true), /Untrusted/);
        await assert.rejects(ensureModelArtifacts({ nsfw: model, vlm: model }, false, undefined, root), /manifest/);
    } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});
