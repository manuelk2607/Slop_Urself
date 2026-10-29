import { readFile } from 'node:fs/promises';
import { createEngine } from './engine.js';
import { qualificationValid, type ModelLock } from './policy.js';
import { runtimeVersion } from './version.js';
import { moderationServer } from './http.js';
import { qualificationEvidence, type QualificationEvidence } from './evidence.js';
import { ensureModelArtifacts } from './artifacts.js';
import { ModerationJobs } from './jobs.js';

const lock = JSON.parse(await readFile('model-lock.json', 'utf8')) as ModelLock;
const version = await runtimeVersion(lock);
let engine: Awaited<ReturnType<typeof createEngine>> | undefined;
let qualification: unknown;
let evidence: QualificationEvidence | undefined;
try { qualification = JSON.parse(process.env.MODERATION_QUALIFICATION_JSON || await readFile(process.env.MODERATION_QUALIFICATION_FILE || 'qualification.json', 'utf8')); } catch { /* /validate remains unavailable. */ }
try { evidence = qualificationEvidence(await readFile(process.env.MODERATION_TEST_REPORT_FILE || 'qualification-report.json'), version); } catch { /* A claim without its actual evidence cannot qualify. */ }
const server = moderationServer({ secret: process.env.MODERATION_SECRET || '', version,
    jobs: new ModerationJobs(process.env.MODERATION_JOB_DB || '/tmp/slop-moderation/jobs.sqlite', process.env.MODERATION_JOB_KEY || process.env.MODERATION_SECRET || '', version),
    qualified: () => qualificationValid(qualification, version, Date.now(), evidence), engine: () => engine });
server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxHeadersCount = 32;
server.listen(Number(process.env.PORT || 7860), '0.0.0.0');
console.info(JSON.stringify({ event: 'moderation_start', modelVersion: version, qualified: qualificationValid(qualification, version, Date.now(), evidence) }));
try {
    await ensureModelArtifacts(lock, true, (role, file, result) => console.info(JSON.stringify({ event: 'model_artifact', role, file, result })));
    engine = await createEngine(lock); console.info(JSON.stringify({ event: 'models_ready' }));
}
catch { console.error(JSON.stringify({ event: 'model_load_failed' })); }
