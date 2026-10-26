import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2), target = args[args.indexOf('--report') + 1];
if (!args.includes('--report') || !target) throw new Error('Use --report with a new report path.');
const runId = randomUUID(), start = Date.now();
const source = import.meta.url.endsWith('.ts');
const child = spawn(process.execPath, [...source ? ['--import', 'tsx'] : [], fileURLToPath(new URL(source ? './evaluate.ts' : './evaluate.js', import.meta.url)), ...args, '--run-id', runId], { stdio: ['ignore', 'pipe', 'pipe'] });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10 * 60_000 + 5000);
child.stdout.on('data', data => { for (const line of String(data).split('\n')) try { const value = JSON.parse(line); if (typeof value.stage === 'string' && /^[a-z_]+$/.test(value.stage)) console.info(JSON.stringify({ stage: value.stage })); } catch { /* No raw model output. */ } });
// The child uses only synthetic fixtures, but native libraries still should not
// dump uncontrolled stack/output into an audit report.
child.stderr.resume();
const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: 1, signal: null }));
});
clearTimeout(timer);
try {
    const report = JSON.parse(await readFile(target, 'utf8'));
    if (report.runId !== runId) throw new Error('Report belongs to another run');
    if (outcome.signal || timedOut) {
        report.status = timedOut ? 'local_execution_deadline' : 'native_runtime_failure';
        report.signal = outcome.signal; report.elapsedMs = Date.now() - start;
        report.qualified = false; report.sufficientForQualification = false;
        await writeFile(`${target}.tmp`, JSON.stringify(report, null, 2), { mode: 0o600 }); await rename(`${target}.tmp`, target);
    }
    console.info(JSON.stringify({ status: report.status, cases: report.cases, qualified: false, sufficientForQualification: false, gpuCalls: 0, exitCode: outcome.code, signal: outcome.signal }));
} catch { console.info(JSON.stringify({ status: 'evaluation_report_unavailable', qualified: false, sufficientForQualification: false, gpuCalls: 0 })); }
process.exitCode = outcome.code ?? 1;
