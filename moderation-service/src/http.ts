import { createServer, type IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { POLICY_VERSION } from './policy.js';
import { ModerationJobs, type JobInput } from './jobs.js';
interface Engine {
    input(image: string, prompt: string, signal?: AbortSignal): Promise<object>;
    output(video: string, signal?: AbortSignal): Promise<object>;
}
export function moderationServer(options: { secret: string; version: string; qualified(): boolean; engine(): Engine | undefined; timeoutMs?: number; jobs?: ModerationJobs }) {
    if (options.secret.length < 32) throw new Error('A separate moderation secret is required');
    let busy = false;
    const jobs = options.jobs || new ModerationJobs(':memory:', options.secret, options.version);
    let stopped = false;
    const execute = async (data: JobInput, signal: AbortSignal) => {
        const engine = options.engine()!;
        if (data.stage === 'input' && typeof data.image === 'string' && typeof data.prompt === 'string' && data.prompt.length <= 1024) return engine.input(data.image, data.prompt, signal);
        if (data.stage === 'output' && typeof data.video === 'string' && data.mime === 'video/mp4') return engine.output(data.video, signal);
        throw new Error('Invalid stage');
    };
    const pump = async () => {
        if (busy || stopped || !options.engine()) return;
        busy = true;
        let ticket: ReturnType<ModerationJobs['claim']>;
        try {
            ticket = jobs.claim(); if (!ticket) return;
            if (!ticket.evaluation && !options.qualified()) { jobs.finish(ticket.id, ticket.run); return; }
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), Math.max(1, Math.min(ticket.lease - Date.now(), options.timeoutMs || 300_000)));
            try {
                const result = await execute(ticket.input, abort.signal);
                abort.signal.throwIfAborted();
                if (stopped || (!ticket.evaluation && !options.qualified())) throw new Error('Approval unavailable');
                jobs.finish(ticket.id, ticket.run, { ...result, digest: ticket.digest, policyVersion: POLICY_VERSION, modelVersion: options.version, ...(ticket.evaluation ? { evaluationOnly: true } : {}) });
            } catch { if (!stopped) jobs.finish(ticket.id, ticket.run); }
            finally { clearTimeout(timer); }
        } catch { /* Storage failures cannot publish approvals. Retry on next tick. */ }
        finally { busy = false; }
    };
    const ticker = setInterval(() => { if (!stopped) { try { jobs.prune(); } catch { /* unavailable */ } void pump(); } }, 1000);
    ticker.unref();
    const server = createServer(async (request, response) => {
        response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
        response.setHeader('x-content-type-options', 'nosniff');
        const send = (status: number, body: unknown) => {
            if (response.destroyed || response.writableEnded) return;
            response.statusCode = status;
            if (!request.complete) response.setHeader('connection', 'close');
            response.end(JSON.stringify(body), () => { if (!request.complete) request.destroy(); });
        };
        const route = request.url;
        if (route === '/health' && request.method === 'GET') { send(200, { ready: Boolean(options.engine() && options.qualified()) }); return; }
        const hash = (value: string) => createHash('sha256').update(value).digest();
        if (!timingSafeEqual(hash(request.headers.authorization || ''), hash(`Bearer ${options.secret}`))) { send(401, { error: 'unauthorized' }); request.resume(); return; }
        if (route === '/jobs/status' && request.method === 'GET') {
            try { send(200, { jobs: jobs.counts(), busy }); } catch { send(503, { error: 'moderation_unavailable' }); }
            return;
        }
        if (route === '/jobs/lookup' && request.method === 'GET') {
            const mode = request.headers['x-moderation-mode'];
            if (!['validate', 'evaluate'].includes(String(mode))) { send(400, {}); return; }
            if (mode === 'validate' && !options.qualified()) { send(503, { error: 'qualification_required' }); return; }
            try {
                const job = jobs.lookup(String(request.headers['x-content-sha256'] || ''), mode === 'evaluate');
                if (!job) { send(404, {}); return; }
                send(202, { id: job.id, digest: job.digest, status: 'pending', ...(job.evaluation ? { evaluationOnly: true } : {}) });
            } catch { send(503, { error: 'moderation_unavailable' }); }
            return;
        }
        const polling = /^\/jobs\/([a-f0-9-]{36})$/.exec(route || '');
        if (polling && request.method === 'GET') {
            let job;
            try { job = jobs.get(polling[1], String(request.headers['x-content-sha256'] || '')); }
            catch { send(503, { error: 'moderation_unavailable' }); return; }
            if (!job) { send(404, {}); return; }
            if (!job.evaluation && !options.qualified()) { send(503, { error: 'qualification_required' }); return; }
            send(['pending', 'running'].includes(job.status) ? 202 : job.status === 'complete' ? 200 : 503,
                job.status === 'complete' ? job.result : { status: job.status === 'running' ? 'pending' : job.status, digest: job.digest }); return;
        }
        const asynchronous = route === '/jobs/validate' || route === '/jobs/evaluate';
        const validation = route === '/validate' || route === '/jobs/validate';
        if ((!asynchronous && !['/validate', '/evaluate'].includes(route || '')) || request.method !== 'POST') { send(404, {}); request.resume(); return; }
        if (!options.engine() || (validation && !options.qualified())) { send(503, { error: 'qualification_required' }); request.resume(); return; }
        if (busy) { response.setHeader('retry-after', '10'); send(429, { error: 'busy' }); request.resume(); return; }
        busy = true;
        const abort = new AbortController();
        const disconnected = () => { if (!response.writableEnded) abort.abort(); };
        response.once('close', disconnected);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const work = (async () => {
            if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
                || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) throw new Error('Invalid request');
            const uploadTimer = setTimeout(() => abort.abort(), Math.min(25_000, options.timeoutMs || 25_000));
            let bytes: Buffer;
            try { bytes = await body(request, abort.signal); } finally { clearTimeout(uploadTimer); }
            const digest = createHash('sha256').update(bytes).digest('hex');
            if (request.headers['x-content-sha256'] !== digest) throw new Error('Content digest mismatch');
            const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { stage?: string; policyVersion?: string; modelVersion?: string; image?: string; prompt?: string; video?: string; mime?: string };
            if (!data || data.policyVersion !== POLICY_VERSION || data.modelVersion !== options.version) throw new Error('Policy/model mismatch');
            abort.signal.throwIfAborted();
            if (!['input', 'output'].includes(data.stage || '')) throw new Error('Invalid stage');
            if (asynchronous) {
                const job = jobs.create(digest, !validation, data as JobInput);
                // Disconnecting the short acknowledgement must not cancel work.
                response.removeListener('close', disconnected);
                send(202, { id: job.id, digest, status: 'pending', ...(job.evaluation ? { evaluationOnly: true } : {}) });
                return undefined;
            }
            const result = await execute(data as JobInput, abort.signal);
            abort.signal.throwIfAborted();
            if (validation && !options.qualified()) throw new Error('Qualification expired during inference');
            return { ...result, digest, policyVersion: POLICY_VERSION, modelVersion: options.version, ...(!validation ? { evaluationOnly: true } : {}) };
        })();
        // A timed-out inference retains the sole compute slot until it actually
        // finishes; new requests cannot accumulate uncancellable model work.
        void work.finally(() => { busy = false; if (asynchronous) void pump(); }).catch(() => {});
        try {
            const limit = asynchronous ? 300_000 : 25_000;
            const result = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Timeout')); }, Math.min(limit, options.timeoutMs || limit)); })]);
            send(200, result);
        } catch { send(503, { error: 'moderation_unavailable' }); }
        finally { clearTimeout(timer); response.removeListener('close', disconnected); }
    });
    server.once('close', () => { stopped = true; clearInterval(ticker); if (!options.jobs) jobs.close(); });
    return server;
}
async function body(request: IncomingMessage, signal: AbortSignal) {
    const limit = 24 * 1024 * 1024;
    if (Number(request.headers['content-length']) > limit) throw new Error('Body too large');
    signal.throwIfAborted();
    return new Promise<Buffer>((resolve, reject) => {
        const parts: Buffer[] = []; let size = 0;
        const cleanup = () => {
            request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', aborted);
            signal.removeEventListener('abort', aborted);
        };
        const fail = (error: Error) => { cleanup(); request.pause(); reject(error); };
        const aborted = () => fail(new Error('Request cancelled'));
        const data = (part: Buffer | string) => {
            const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part); size += chunk.length;
            if (size > limit) fail(new Error('Body too large'));
            else parts.push(chunk);
        };
        const end = () => { cleanup(); resolve(Buffer.concat(parts, size)); };
        request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', aborted);
        signal.addEventListener('abort', aborted, { once: true });
    });
}
