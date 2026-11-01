import { readFile } from 'node:fs/promises';
import { createEngine } from './engine.js';
import { qualificationValid, type ModelLock } from './policy.js';
import { runtimeVersion, managedRuntimeVersion } from './version.js';
import { createManagedEngine } from './managed.js';
import { ManagedRequestBudget } from './request-budget.js';
import { moderationServer } from './http.js';
import { qualificationEvidence, type QualificationEvidence } from './evidence.js';
import { ensureModelArtifacts } from './artifacts.js';
import { ModerationJobs } from './jobs.js';

const lock = JSON.parse(await readFile('model-lock.json', 'utf8')) as ModelLock;
const backend = process.env.MODERATION_BACKEND || 'local';
if (!['local', 'managed'].includes(backend)) throw new Error('Unknown moderation backend');
const contextProvider = process.env.GEMINI_MODERATION_API_KEY && process.env.GEMINI_UNBILLED_PROJECT_CONFIRMED === 'yes'
    ? 'gemini-free' : process.env.MODERATION_CONTEXT_APPROVED === 'yes' ? 'openai' : 'disabled';
const screening=process.env.MODERATION_MANAGED_SCREENING||'openai-and-context';
if(screening!=='openai-and-context'&&screening!=='gemini-only') throw new Error('Unknown managed screening policy');
const version = backend === 'managed' ? await managedRuntimeVersion(contextProvider,screening) : await runtimeVersion(lock);
let engine: { input(image: string, prompt: string, signal?: AbortSignal): Promise<object>; output(video: string, signal?: AbortSignal): Promise<object> } | undefined;
let qualification: unknown;
let evidence: QualificationEvidence | undefined;
try { qualification = JSON.parse(process.env.MODERATION_QUALIFICATION_JSON || await readFile(process.env.MODERATION_QUALIFICATION_FILE || 'qualification.json', 'utf8')); } catch { /* /validate remains unavailable. */ }
try { evidence = qualificationEvidence(await readFile(process.env.MODERATION_TEST_REPORT_FILE || 'qualification-report.json'), version); } catch { /* A claim without its actual evidence cannot qualify. */ }
const server = moderationServer({ secret: process.env.MODERATION_SECRET || '', version,
    jobs: new ModerationJobs(process.env.MODERATION_JOB_DB || '/tmp/slop-moderation/jobs.sqlite', process.env.MODERATION_JOB_KEY || process.env.MODERATION_SECRET || '', version),
    qualified: () => (backend !== 'managed' || process.env.MODERATION_CONTEXT_APPROVED === 'yes'
        || Boolean(process.env.GEMINI_MODERATION_API_KEY && process.env.GEMINI_UNBILLED_PROJECT_CONFIRMED === 'yes')) && qualificationValid(qualification, version, Date.now(), evidence), engine: () => engine });
server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxHeadersCount = 32;
server.listen(Number(process.env.PORT || 7860), '0.0.0.0');
console.info(JSON.stringify({ event: 'moderation_start', modelVersion: version, qualified: (backend !== 'managed' || contextProvider !== 'disabled') && qualificationValid(qualification, version, Date.now(), evidence) }));
try {
    if (backend === 'managed') {
        // The durable cap survives restarts; operator changes are explicit.
        const budget = new ManagedRequestBudget(process.env.MODERATION_BUDGET_DB || '/tmp/slop-moderation/budget.sqlite', Number(process.env.MODERATION_MAX_REQUESTS));
        engine = createManagedEngine({ apiKey: process.env.OPENAI_MODERATION_API_KEY,screening,
            contextAuthorized: process.env.MODERATION_CONTEXT_APPROVED === 'yes', maxRequests: Number(process.env.MODERATION_MAX_REQUESTS), reserveRequest: () => budget.reserve(),
            geminiKey: process.env.GEMINI_MODERATION_API_KEY, geminiFreeProjectConfirmed: process.env.GEMINI_UNBILLED_PROJECT_CONFIRMED === 'yes' });
    } else {
    await ensureModelArtifacts(lock, true, (role, file, result) => console.info(JSON.stringify({ event: 'model_artifact', role, file, result })));
    engine = await createEngine(lock); console.info(JSON.stringify({ event: 'models_ready' }));
    }
}
catch { console.error(JSON.stringify({ event: 'model_load_failed' })); }
