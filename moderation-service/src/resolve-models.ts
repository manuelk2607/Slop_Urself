import { writeFile } from 'node:fs/promises';
const models = { nsfw: 'onnx-community/nsfw_image_detection-ONNX', vlm: 'HuggingFaceTB/SmolVLM-500M-Instruct' };
const lock: Record<string, { id: string; revision: string }> = {};
for (const [role, id] of Object.entries(models)) {
    const response = await fetch(`https://huggingface.co/api/models/${id}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Public model metadata unavailable: ${role} (${response.status})`);
    const metadata = await response.json() as { sha?: string; siblings?: { rfilename: string }[] };
    if (!metadata.sha || !/^[a-f0-9]{40}$/.test(metadata.sha) || !metadata.siblings?.some(f => f.rfilename.endsWith('.onnx'))) throw new Error(`Missing immutable ONNX model: ${role}`);
    lock[role] = { id, revision: metadata.sha };
}
await writeFile('model-lock.json', JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' });
console.info('Created pinned model-lock.json. No models downloaded and no content evaluated.');
