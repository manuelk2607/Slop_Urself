import { createServer, type IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { POLICY_VERSION } from './policy.js';
interface Engine {
    input(image: string, prompt: string, signal?: AbortSignal): Promise<object>;
    output(video: string, signal?: AbortSignal): Promise<object>;
}
export function moderationServer(options: { secret: string; version: string; qualified(): boolean; engine(): Engine | undefined; timeoutMs?: number }) {
    if (options.secret.length < 32) throw new Error('A separate moderation secret is required');
    let busy = false;
    return createServer(async (request, response) => {
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
        if (!['/validate', '/evaluate'].includes(route || '') || request.method !== 'POST') { send(404, {}); request.resume(); return; }
        if (!options.engine() || (route === '/validate' && !options.qualified())) { send(503, { error: 'qualification_required' }); request.resume(); return; }
        if (busy) { response.setHeader('retry-after', '10'); send(429, { error: 'busy' }); request.resume(); return; }
        busy = true;
        const abort = new AbortController();
        const disconnected = () => { if (!response.writableEnded) abort.abort(); };
        response.once('close', disconnected);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const work = (async () => {
            if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
                || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) throw new Error('Invalid request');
            const bytes = await body(request, abort.signal), digest = createHash('sha256').update(bytes).digest('hex');
            if (request.headers['x-content-sha256'] !== digest) throw new Error('Content digest mismatch');
            const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { stage?: string; policyVersion?: string; modelVersion?: string; image?: string; prompt?: string; video?: string; mime?: string };
            if (!data || data.policyVersion !== POLICY_VERSION || data.modelVersion !== options.version) throw new Error('Policy/model mismatch');
            const engine = options.engine()!;
            let result: object;
            abort.signal.throwIfAborted();
            if (data.stage === 'input' && typeof data.image === 'string' && typeof data.prompt === 'string' && data.prompt.length <= 1024) result = await engine.input(data.image, data.prompt, abort.signal);
            else if (data.stage === 'output' && typeof data.video === 'string' && data.mime === 'video/mp4') result = await engine.output(data.video, abort.signal);
            else throw new Error('Invalid stage');
            abort.signal.throwIfAborted();
            if (route === '/validate' && !options.qualified()) throw new Error('Qualification expired during inference');
            return { ...result, digest, policyVersion: POLICY_VERSION, modelVersion: options.version, ...(route === '/evaluate' ? { evaluationOnly: true } : {}) };
        })();
        // A timed-out inference retains the sole compute slot until it actually
        // finishes; new requests cannot accumulate uncancellable model work.
        void work.finally(() => { busy = false; }).catch(() => {});
        try {
            const result = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Timeout')); }, Math.min(25_000, options.timeoutMs || 25_000)); })]);
            send(200, result);
        } catch { send(503, { error: 'moderation_unavailable' }); }
        finally { clearTimeout(timer); response.removeListener('close', disconnected); }
    });
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
