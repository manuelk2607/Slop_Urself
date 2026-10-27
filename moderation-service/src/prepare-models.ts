import { readFile } from 'node:fs/promises';
import { ensureModelArtifacts } from './artifacts.js';
import type { ModelLock } from './policy.js';
delete process.env.HF_TOKEN; delete process.env.HF_ACCESS_TOKEN;
const lock = JSON.parse(await readFile('model-lock.json', 'utf8')) as ModelLock;
try { await ensureModelArtifacts(lock, true, (role, file, result) => console.info(JSON.stringify({ event: 'model_artifact', role, file, result }))); }
catch { console.error(JSON.stringify({ event: 'model_prepare_failed' })); process.exitCode = 1; }
