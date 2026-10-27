import { writeFile } from 'node:fs/promises';
const models = { nsfw: 'onnx-community/nsfw_image_detection-ONNX', vlm: 'HuggingFaceTB/SmolVLM-500M-Instruct' };
const lock: Record<string, { id: string; revision: string; files: { path: string; bytes: number; sha256: string }[] }> = {};
for (const [role, id] of Object.entries(models)) {
    const response = await fetch(`https://huggingface.co/api/models/${id}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Public model metadata unavailable: ${role} (${response.status})`);
    const metadata = await response.json() as { sha?: string; siblings?: { rfilename: string }[] };
    if (!metadata.sha || !/^[a-f0-9]{40}$/.test(metadata.sha) || !metadata.siblings?.some(f => f.rfilename.endsWith('.onnx'))) throw new Error(`Missing immutable ONNX model: ${role}`);
    const treeResponse = await fetch(`https://huggingface.co/api/models/${id}/tree/${metadata.sha}/onnx?expand=true`, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!treeResponse.ok) throw new Error(`Public artifact metadata unavailable: ${role}`);
    const tree = await treeResponse.json() as { path: string; size: number; lfs?: { oid: string } }[];
    const paths = role === 'nsfw' ? ['onnx/model.onnx'] : ['onnx/decoder_model_merged.onnx', 'onnx/embed_tokens.onnx', 'onnx/vision_encoder.onnx'];
    const files = paths.map(path => {
        const file = tree.find(file => file.path === path);
        if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || !file.lfs?.oid || !/^[a-f0-9]{64}$/.test(file.lfs.oid)) throw new Error(`Missing pinned artifact metadata: ${role}`);
        return { path, bytes: file.size, sha256: file.lfs.oid };
    });
    lock[role] = { id, revision: metadata.sha, files };
}
await writeFile('model-lock.json', JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' });
console.info('Created pinned model-lock.json. No models downloaded and no content evaluated.');
