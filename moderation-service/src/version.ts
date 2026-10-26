import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modelVersion, type ModelLock } from './policy.js';

export async function runtimeVersion(lock: ModelLock) {
    const hash = createHash('sha256');
    // Approval also expires when inference, parsing or dependency code changes,
    // even if model weights and the written policy remain identical.
    const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
    for (const name of ['engine', 'media', 'http', 'policy', 'server', 'version']) {
        hash.update(name).update(await readFile(new URL(`./${name}${extension}`, import.meta.url)));
    }
    hash.update(await readFile('package-lock.json'));
    return modelVersion(lock, hash.digest('hex'));
}
