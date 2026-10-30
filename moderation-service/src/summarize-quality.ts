import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { qualityMetrics } from './quality-metrics.js';

const [input, output] = process.argv.slice(2);
if (!input || !output || input === output) throw new Error('Pass an existing diagnostic and a NEW summary path.');
const bytes = await readFile(input);
if (bytes.length > 1024 * 1024) throw new Error('Diagnostic too large');
const report = JSON.parse(bytes.toString('utf8'));
const summary = { ...qualityMetrics(report.cases), sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceModelVersion: typeof report.modelVersion === 'string' && /^[a-f0-9]{64}$/.test(report.modelVersion) ? report.modelVersion : null };
await writeFile(output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.info(JSON.stringify(summary));
