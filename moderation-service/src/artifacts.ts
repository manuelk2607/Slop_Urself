import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LockedModel, ModelArtifact, ModelLock } from './policy.js';
export const modelCacheRoot = () => process.env.MODEL_CACHE_DIR || join(tmpdir(), 'slop-model-cache');

function artifactPath(root: string, model: LockedModel, file: ModelArtifact) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(model.id) || model.id.split('/').some(part => part === '.' || part === '..')
        || !/^[a-f0-9]{40}$/.test(model.revision) || !/^onnx\/[a-zA-Z0-9_-]+\.onnx$/.test(file.path)
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 2_000_000_000 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid pinned model artifact');
    // Transformers.js v3 includes the immutable revision in its cache path.
    return join(root, model.id, model.revision, file.path);
}
async function valid(path: string, file: ModelArtifact) {
    try {
        const info = await stat(path); if (!info.isFile() || info.size !== file.bytes) return false;
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        return hash.digest('hex') === file.sha256;
    } catch { return false; }
}
async function publicDownload(model: LockedModel, file: ModelArtifact) {
    let url = new URL(`https://huggingface.co/${model.id}/resolve/${model.revision}/${file.path}`);
    const signal = AbortSignal.timeout(30 * 60_000);
    for (let hop = 0; hop < 5; hop++) {
        if (url.protocol !== 'https:' || url.username || url.password || url.port
            || !(url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co'))) throw new Error('Untrusted model download host');
        // Deliberately no HF/user credential. These exact public files are free.
        const response = await fetch(url, { redirect: 'manual', signal });
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            await response.body?.cancel(); url = new URL(response.headers.get('location')!, url); continue;
        }
        if (!response.ok || !response.body || (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== file.bytes)) {
            await response.body?.cancel(); throw new Error('Pinned model download unavailable or incomplete');
        }
        return response;
    }
    throw new Error('Too many model download redirects');
}
export async function ensureArtifact(model: LockedModel, file: ModelArtifact, root: string, download = false) {
    const target = artifactPath(root, model, file);
    if (await valid(target, file)) return 'cached';
    if (!download) throw new Error('Pinned model cache integrity failed. Run models:prepare before inference.');
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.partial-${randomUUID()}`;
    try {
        const response = await publicDownload(model, file);
        const reader = response.body!.getReader(), hash = createHash('sha256'); let bytes = 0;
        let output: Awaited<ReturnType<typeof open>> | undefined;
        try {
            output = await open(temporary, 'wx', 0o600);
            for (;;) {
                const part = await reader.read(); if (part.done) break;
                bytes += part.value.length; if (bytes > file.bytes) throw new Error('Model download exceeds pinned size');
                hash.update(part.value);
                let offset = 0;
                while (offset < part.value.length) {
                    const written = await output.write(part.value, offset, part.value.length - offset);
                    if (!written.bytesWritten) throw new Error('Model cache write failed');
                    offset += written.bytesWritten;
                }
            }
            if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error('Model download integrity failed');
            await output.sync();
        } finally { await reader.cancel().catch(() => {}); await output?.close(); }
        // An interrupted/corrupt download never replaces even the previous cache.
        await rename(temporary, target);
        return 'downloaded';
    } finally { await rm(temporary, { force: true }); }
}
export async function ensureModelArtifacts(lock: ModelLock, download = false, stage: (role: string, file: string, result: string) => void = () => {}, root = modelCacheRoot()) {
    const expected = { nsfw: ['onnx/model.onnx'], vlm: ['onnx/decoder_model_merged.onnx', 'onnx/embed_tokens.onnx', 'onnx/vision_encoder.onnx'] };
    for (const role of ['nsfw', 'vlm'] as const) {
        const model = lock[role];
        if (!model.files || model.files.length !== expected[role].length || new Set(model.files.map(file => file.path)).size !== model.files.length
            || expected[role].some(path => !model.files!.some(file => file.path === path))) throw new Error('Missing pinned model file manifest');
        for (const file of model.files) { stage(role, file.path, 'verifying'); stage(role, file.path, await ensureArtifact(model, file, root, download)); }
    }
}
