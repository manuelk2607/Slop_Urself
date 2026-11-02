import { createServer, type IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ModerationJobs, type JobInput, type StoredJob } from './jobs.js';
import { POLICY_VERSION } from './policy.js';

interface InputCase { accountId: string; pixelSha256: string; prompt: string }
interface Payload extends JobInput { validationScope: string; jobId: string; accountId: string }
interface Engine { input(image: string, prompt: string, signal?: AbortSignal): Promise<object>; output(video: string, signal?: AbortSignal): Promise<object> }
interface Options { id: string; expiresAt: number; secret: string; version: string; directory: string; cases: InputCase[]; engine: Engine }
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s);

/** Separate, finite operator-reviewed campaign. It cannot qualify the normal
 * moderation server, and never serves general /evaluate or unauthenticated files.
 * Output approval additionally requires the operator's digest-specific review.
 */
export async function validationModerator(options: Options) {
    if (!uuid(options.id) || options.expiresAt <= Date.now() || options.expiresAt > Date.now() + 6 * 3600_000 || options.secret.length < 32
        || !/^[a-f0-9]{64}$/.test(options.version) || options.cases.length !== 2 || new Set(options.cases.map(c => c.accountId)).size !== 2
        || options.cases.some(c => !uuid(c.accountId) || !/^[a-f0-9]{64}$/.test(c.pixelSha256) || !c.prompt || c.prompt.length > 512)) throw Error('Bounded validation configuration required');
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const jobs = new ModerationJobs(join(options.directory, 'jobs.sqlite'), options.secret, options.version);
    const bindings = new DatabaseSync(join(options.directory, 'bindings.sqlite'));
    await chmod(join(options.directory, 'bindings.sqlite'), 0o600);
    bindings.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS inputs (account TEXT PRIMARY KEY, job TEXT UNIQUE NOT NULL, allowed INTEGER NOT NULL DEFAULT 0);');
    let busy = false, stopped = false;
    const active = () => !stopped && options.expiresAt > Date.now();
    const authorized = async (data: Payload, bind = false) => {
        if (!active() || data.validationScope !== options.id || !uuid(data.jobId)) throw Error('Invalid validation scope');
        const input = options.cases.find(c => c.accountId === data.accountId); if (!input) throw Error('Unknown account');
        const existing = bindings.prepare('SELECT job,allowed FROM inputs WHERE account=?').get(input.accountId) as { job: string; allowed: number } | undefined;
        if (existing && existing.job !== data.jobId) throw Error('A different job already owns this validation slot');
        if (data.stage === 'input') {
            if (data.prompt !== input.prompt || typeof data.image !== 'string') throw Error('Unapproved prompt');
            const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.image);
            if (!match || match[1].length > 12 * 1024 * 1024 || match[1].length % 4) throw Error('Invalid image');
            const image = sharp(Buffer.from(match[1], 'base64'), { limitInputPixels: 640 * 640, failOn: 'error' });
            const meta = await image.metadata();
            if (meta.format !== 'png' || meta.width !== 640 || meta.height !== 640 || (meta.pages || 1) !== 1
                || hash(await image.ensureAlpha().raw().toBuffer()) !== input.pixelSha256) throw Error('Unapproved image');
            if (bind && !existing) bindings.prepare('INSERT INTO inputs(account,job) VALUES(?,?)').run(input.accountId, data.jobId);
        } else if (data.stage !== 'output' || !existing?.allowed || typeof data.video !== 'string' || data.mime !== 'video/mp4') throw Error('No approved input for output');
    };
    const outputReady = async (result: Record<string, unknown>) => {
        if (result.manualReviewPending !== true) return result;
        let approvals: { jobId: string; sha256: string; operatorApproved: boolean; reviewedAt: number }[];
        try { approvals = JSON.parse(await readFile(join(options.directory, 'output-approvals.json'), 'utf8')); } catch { return; }
        if (!Array.isArray(approvals) || !approvals.some(a => a.jobId === result.generationId && a.sha256 === result.videoSha256 && a.operatorApproved === true
            && Number.isSafeInteger(a.reviewedAt) && a.reviewedAt >= Number(result.reviewAvailableAt) && a.reviewedAt <= Date.now())) return;
        const { manualReviewPending: _, ...ready } = result;
        return { ...ready, decision: 'allow' };
    };
    const pump = async () => {
        if (busy || !active()) return; busy = true;
        let ticket: ReturnType<ModerationJobs['claim']>;
        try {
            ticket = jobs.claim(); if (!ticket) return;
            const data = ticket.input as Payload;
            await authorized(data);
            const signal = AbortSignal.timeout(Math.max(1, Math.min(120_000, ticket.lease - Date.now())));
            const result = await (data.stage === 'input' ? options.engine.input(data.image!, data.prompt!, signal) : options.engine.output(data.video!, signal)) as Record<string, unknown>;
            signal.throwIfAborted(); await authorized(data);
            let review: Record<string, unknown> = {};
            if (result.decision === 'allow' && result.decodeComplete === true) {
                if (data.stage === 'input') bindings.prepare('UPDATE inputs SET allowed=1 WHERE account=? AND job=?').run(data.accountId, data.jobId);
                else {
                    if (result.codec !== 'h264' || result.pixelFormat !== 'yuv420p' || result.frameCount !== 121 || result.framesChecked !== 121
                        || typeof result.durationSeconds !== 'number' || result.durationSeconds < 5 || result.durationSeconds > 9) throw Error('Incomplete output');
                    const bytes = Buffer.from(data.video!, 'base64');
                    await writeFile(join(options.directory, `${data.jobId}.mp4`), bytes, { mode: 0o600 });
                    review = { decision: 'review', manualReviewPending: true, generationId: data.jobId, videoSha256: hash(bytes), reviewAvailableAt: Date.now() };
                }
            }
            jobs.finish(ticket.id, ticket.run, { ...result, ...review, digest: ticket.digest, policyVersion: POLICY_VERSION, modelVersion: options.version, validationScope: options.id });
        } catch { if (ticket!) jobs.finish(ticket.id, ticket.run); }
        finally { busy = false; if (stopped) { jobs.close(); bindings.close(); } }
    };
    const ticker = setInterval(() => { void pump(); }, 500); ticker.unref();
    const server = createServer(async (request, response) => {
        response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store'); response.setHeader('x-content-type-options', 'nosniff');
        const send = (status: number, value: unknown) => { response.statusCode = status; response.end(JSON.stringify(value)); };
        const token = createHash('sha256').update(request.headers.authorization || '').digest(), expected = createHash('sha256').update(`Bearer ${options.secret}`).digest();
        if (!timingSafeEqual(token, expected)) { request.resume(); send(401, {}); return; }
        if (!active() || request.headers['x-live-validation'] !== options.id) { request.resume(); send(503, { error: 'validation_scope_required' }); return; }
        const digest = String(request.headers['x-content-sha256'] || '');
        if (!/^[a-f0-9]{64}$/.test(digest)) { request.resume(); send(503, {}); return; }
        const deliver = async (job: StoredJob | undefined) => {
            if (!job) { send(404, {}); return; }
            const ready = job.result && await outputReady(job.result as Record<string, unknown>);
            if (!active()) { send(503, {}); return; }
            if (job.status === 'complete' && ready) send(200, ready);
            else send(job.status === 'failed' ? 503 : 202, { id: job.id, digest: job.digest, status: 'pending' });
        };
        try {
            if (request.method === 'GET') {
                const match = /^\/jobs\/([a-f0-9-]{36})$/.exec(request.url || '');
                if (request.url === '/jobs/lookup') await deliver(jobs.lookup(digest, false));
                else if (match) await deliver(jobs.get(match[1], digest));
                else send(404, {});
                return;
            }
            if (request.method !== 'POST' || request.url !== '/jobs/validate' || request.headers['content-type']?.split(';')[0] !== 'application/json'
                || request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') { request.resume(); send(404, {}); return; }
            const bytes = await boundedBody(request);
            if (hash(bytes) !== digest) throw Error('Digest mismatch');
            const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Payload & { policyVersion?: string; modelVersion?: string };
            if (data.policyVersion !== POLICY_VERSION || data.modelVersion !== options.version) throw Error('Version mismatch');
            await authorized(data, true);
            const job = jobs.create(digest, false, data);
            await deliver(job); void pump();
        } catch { if (!response.writableEnded) send(503, {}); }
    });
    server.once('close', () => { stopped = true; clearInterval(ticker); if (!busy) { jobs.close(); bindings.close(); } });
    server.headersTimeout = 10_000; server.requestTimeout = 30_000;
    return server;
}
async function boundedBody(request: IncomingMessage) {
    const maximum = 24 * 1024 * 1024;
    if (Number(request.headers['content-length']) > maximum) throw Error('Body too large');
    const timer = setTimeout(() => request.destroy(), 25_000), parts: Buffer[] = []; let size = 0;
    try { for await (const part of request) { size += Buffer.byteLength(part); if (size > maximum) throw Error('Body too large'); parts.push(Buffer.from(part)); } return Buffer.concat(parts); }
    finally { clearTimeout(timer); }
}
