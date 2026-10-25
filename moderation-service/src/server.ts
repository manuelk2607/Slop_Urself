import { readFile } from 'node:fs/promises';
import { createEngine } from './engine.js';
import { modelVersion, qualificationValid, type ModelLock } from './policy.js';
import { moderationServer } from './http.js';

const lock = JSON.parse(await readFile('model-lock.json', 'utf8')) as ModelLock;
const version = modelVersion(lock);
let engine: Awaited<ReturnType<typeof createEngine>> | undefined;
let qualification: unknown;
try { qualification = JSON.parse(process.env.MODERATION_QUALIFICATION_JSON || await readFile(process.env.MODERATION_QUALIFICATION_FILE || 'qualification.json', 'utf8')); } catch { /* /validate remains unavailable. */ }
const server = moderationServer({ secret: process.env.MODERATION_SECRET || '', version,
    qualified: () => qualificationValid(qualification, version), engine: () => engine });
server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxHeadersCount = 32;
server.listen(Number(process.env.PORT || 7860), '0.0.0.0');
console.info(JSON.stringify({ event: 'moderation_start', modelVersion: version, qualified: qualificationValid(qualification, version) }));
try { engine = await createEngine(lock); console.info(JSON.stringify({ event: 'models_ready' })); }
catch { console.error(JSON.stringify({ event: 'model_load_failed' })); }
