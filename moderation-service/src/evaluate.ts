import { readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import { createEngine, type ModelAssessment } from './engine.js';
import { runtimeVersion } from './version.js';
import { evaluationCases } from './evaluation-cases.js';
import { semanticAssessment } from './policy.js';
const selected = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : undefined;
const selectable: readonly string[] = [...evaluationCases.map(item => item.id), 'benign-five-second-video'];
if (process.argv.includes('--case') && (!selected || !selectable.includes(selected))) throw new Error('Unknown diagnostic case');
const protocol = process.argv.includes('--protocol') ? process.argv[process.argv.indexOf('--protocol') + 1] : undefined;
if (process.argv.includes('--protocol') && !['json-v1', 'labels-v1', 'labels-v2', 'roles-v1'].includes(protocol || '')) throw new Error('Unknown diagnostic protocol');
const target = process.argv[process.argv.indexOf('--report') + 1];
if (!process.argv.includes('--report') || !target) throw new Error('Use --report with a new report path. This opt-in command downloads pinned public CPU models.');
// The benchmark needs no personal HF credential and must not accidentally use one.
delete process.env.HF_TOKEN; delete process.env.HF_ACCESS_TOKEN;
const runId = process.argv[process.argv.indexOf('--run-id') + 1];
if (!process.argv.includes('--run-id') || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Start through evaluate:local, which supervises native runtime failures.');
const report: { runId: string; qualified: false; sufficientForQualification: false; gpuCalls: 0; status: string; modelVersion?: string; elapsedMs?: number; failureStage?: string; technicalFailure?: string; cases: object[]; limitations: string[] } = {
    runId,
    qualified: false, sufficientForQualification: false, gpuCalls: 0, status: 'starting', cases: [],
    limitations: ['Synthetic nonsexual drawings only; no real-person/illegal media.', 'No hosting, legal consent, CSAM detection or real HF video billing qualification.', 'Five-frame diagnostic video is not an 81-frame Wan performance benchmark.']
};
await writeFile(target, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
if (selected) report.limitations.push('One selected diagnostic case only; no representative quality claim.');
const checkpoint = async () => { await writeFile(`${target}.tmp`, JSON.stringify(report, null, 2), { mode: 0o600 }); await rename(`${target}.tmp`, target); };
const start = Date.now();
const watchdog = setTimeout(() => {
    report.status = 'local_execution_deadline'; report.elapsedMs = Date.now() - start;
    void checkpoint().finally(() => process.exit(2));
}, 10 * 60_000);
try {
    const lock = JSON.parse(await readFile('model-lock.json', 'utf8'));
    if (protocol) { lock.decisionProtocol = protocol; report.limitations.push(`Experimental decision protocol: ${protocol}; separate implementation fingerprint, no release.`); }
    report.modelVersion = await runtimeVersion(lock);
    let lastAssessment: ModelAssessment | undefined;
    const engine = await createEngine(lock, async stage => { report.status = stage; await checkpoint(); console.info(JSON.stringify({ stage })); }, assessment => { lastAssessment = assessment; });
    const image = await sharp(Buffer.from('<svg width="256" height="192" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="192" fill="#87ceeb"/><rect y="160" width="256" height="32" fill="#62a744"/><circle cx="128" cy="110" r="35" fill="#ffdf00"/></svg>')).png().toBuffer();
    const input = `data:image/png;base64,${image.toString('base64')}`;
    for (const item of evaluationCases) {
        if (selected && selected !== item.id) continue;
        lastAssessment = undefined;
        const before = Date.now();
        try {
            const value = await engine.input(input, item.prompt, AbortSignal.timeout(25_000));
            // The observer runs inside engine.input; TypeScript cannot follow
            // that asynchronous callback assignment after the reset above.
            const semantic = semanticAssessment(value.decision, (lastAssessment as ModelAssessment | undefined)?.reason);
            report.cases.push({ id: item.id, expected: item.expected, decision: value.decision, assessment: lastAssessment,
                semanticAssessment: semantic, safeHold: value.decision !== 'allow',
                passed: semantic && (item.expected === 'allow' ? value.decision === 'allow' : value.decision !== 'allow'), elapsedMs: Date.now() - before });
        } catch { report.cases.push({ id: item.id, expected: item.expected, outcome: 'technical_failure', passed: false, elapsedMs: Date.now() - before }); }
        await checkpoint();
    }
    if (!selected || selected === 'benign-five-second-video') {
    const directory = await mkdtemp(join(tmpdir(), 'slop-evaluation-'));
    try {
        const path = join(directory, 'safe.mp4');
        await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=256x192:r=1:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { timeout: 10_000 });
        const before = Date.now();
        try {
            const value = await engine.output((await readFile(path)).toString('base64'), AbortSignal.timeout(25_000));
            report.cases.push({ id: 'benign-five-second-video', decision: value.decision, frameCount: value.frameCount, framesChecked: value.framesChecked,
                uniqueFramesChecked: value.uniqueFramesChecked, passed: value.decision === 'allow' && value.framesChecked === value.frameCount, elapsedMs: Date.now() - before });
        } catch { report.cases.push({ id: 'benign-five-second-video', outcome: 'technical_failure', passed: false, elapsedMs: Date.now() - before }); }
    } finally { await rm(directory, { recursive: true, force: true }); }
    }
    const passed = report.cases.every(item => (item as { passed?: unknown }).passed === true);
    report.status = passed ? 'diagnostic_completed' : 'diagnostic_failed';
    if (!passed) process.exitCode = 2;
} catch (error) {
    report.failureStage = report.status;
    // Diagnostic uses public model files and synthetic inputs only. Even there,
    // strip URLs, local paths and token-like strings before saving an error.
    report.technicalFailure = String(error instanceof Error ? error.message : 'unknown').replace(/https?:\/\/\S+/g, '[model-url]').replace(/hf_[A-Za-z0-9]+/g, '[redacted]').replace(/\/(?:Users|private|var|tmp|opt)\/\S+/g, '[local-path]').slice(0, 500);
    report.status = 'model_initialization_failed'; process.exitCode = 1;
}
finally { clearTimeout(watchdog); report.elapsedMs = Date.now() - start; await checkpoint(); console.info(JSON.stringify(report)); }
