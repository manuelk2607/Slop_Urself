import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { modelVersion, POLICY, POLICY_VERSION, type ModelLock } from './policy.js';
import { MANAGED_MODELS } from './managed.js';
import { GEMINI_MODEL } from './gemini.js';

export async function runtimeVersion(lock: ModelLock) {
    return modelVersion(lock, await implementationFingerprint());
}
async function implementationFingerprint() {
    const hash = createHash('sha256');
    // Approval also expires when inference, parsing or dependency code changes,
    // even if model weights and the written policy remain identical.
    const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
    for (const name of ['engine', 'managed', 'gemini', 'request-budget', 'context-output', 'context-messages', 'artifacts', 'media', 'preprocessing', 'http', 'jobs', 'policy', 'evidence', 'server', 'version']) {
        hash.update(name).update(await readFile(new URL(`./${name}${extension}`, import.meta.url)));
    }
    hash.update(await readFile('package-lock.json'));
    return hash.digest('hex');
}
export async function managedRuntimeVersion(contextProvider: 'disabled' | 'openai' | 'gemini-free' = 'disabled', screening: 'openai-and-context' | 'gemini-only' = 'openai-and-context') {
    return createHash('sha256').update(JSON.stringify({ models: MANAGED_MODELS, gemini: GEMINI_MODEL, policy: POLICY, policyVersion: POLICY_VERSION,
        contextProvider, screening, implementation: await implementationFingerprint(), protocol: 'managed-v1' })).digest('hex');
}
