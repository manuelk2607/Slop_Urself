import sharp from 'sharp';
import { assessContext, POLICY, type Assessment, type Decision } from './policy.js';
import { checkAbort, inspectVideo, MAX_MEDIA_EDGE } from './media.js';
import { quoteAction } from './context-messages.js';
import { GEMINI_MODEL, geminiPayload, geminiVerdict } from './gemini.js';

// Snapshots only; never fall back to another model or a caller-supplied URL.
export const MANAGED_MODELS = Object.freeze({ moderation: 'omni-moderation-2024-09-26', context: 'gpt-5.4-nano-2026-03-17' });
const categories = ['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening',
    'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'];
const highRisk = ['sexual/minors', 'illicit/violent', 'self-harm/instructions', 'violence/graphic'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export class ManagedModerationError extends Error {
    constructor(readonly code: 'provider_unavailable' | 'provider_schema' | 'provider_model_drift' | 'context_not_authorized' | 'request_budget_exhausted',
        readonly httpStatus?: number, readonly provider?: 'moderations' | 'responses' | 'gemini') { super(code); }
}
export function managedVerdict(body: unknown): Assessment {
    if (!record(body) || body.model !== MANAGED_MODELS.moderation) throw new ManagedModerationError('provider_model_drift');
    if (!Array.isArray(body.results) || body.results.length !== 1 || !record(body.results[0])) throw new ManagedModerationError('provider_schema');
    const r = body.results[0], flags = r.categories, scores = r.category_scores, types = r.category_applied_input_types;
    if (typeof r.flagged !== 'boolean' || !record(flags) || !record(scores) || !record(types)
        || categories.some(k => typeof flags[k] !== 'boolean' || typeof scores[k] !== 'number' || !Number.isFinite(scores[k]) || scores[k] < 0 || scores[k] > 1
            || !Array.isArray(types[k]) || (types[k] as unknown[]).some(v => v !== 'text' && v !== 'image'))
        || !(types.sexual as unknown[]).includes('image') || !(types['violence/graphic'] as unknown[]).includes('image')) throw new ManagedModerationError('provider_schema');
    if (highRisk.some(k => flags[k])) return { decision: 'block', reason: 'context_prohibited' };
    // An unsupported visual minors score of zero is NOT evidence of adult age.
    if (r.flagged || categories.some(k => flags[k])) return { decision: 'review', reason: 'context_uncertain' };
    return { decision: 'allow', reason: 'clear' };
}
export function contextVerdict(body: unknown): Assessment {
    if (!record(body) || body.model !== MANAGED_MODELS.context) throw new ManagedModerationError('provider_model_drift');
    if (body.status !== 'completed' || !Array.isArray(body.output)) throw new ManagedModerationError('provider_schema');
    const texts: string[] = [];
    for (const item of body.output) {
        if (!record(item)) throw new ManagedModerationError('provider_schema');
        if (item.type === 'reasoning') continue;
        if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) throw new ManagedModerationError('provider_schema');
        for (const content of item.content) {
            if (!record(content) || content.type !== 'output_text' || typeof content.text !== 'string') throw new ManagedModerationError('provider_schema');
            texts.push(content.text);
        }
    }
    if (texts.length !== 1) throw new ManagedModerationError('provider_schema');
    return assessContext(texts[0]);
}
async function png(image: string) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match || match[1].length % 4 || match[1].length > 12 * 1024 * 1024) throw new Error('Invalid normalized image');
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG signature');
    const decoder = sharp(bytes, { limitInputPixels: 832 * 832, failOn: 'error' });
    const meta = await decoder.metadata();
    if (meta.format !== 'png' || (meta.pages || 1) !== 1 || !meta.width || !meta.height || meta.width > MAX_MEDIA_EDGE || meta.height > MAX_MEDIA_EDGE) throw new Error('Invalid decoded image');
    // Decode all pixels before transmission; remove metadata and normalize alpha.
    return decoder.flatten({ background: '#fff' }).removeAlpha().png().toBuffer();
}
export function createManagedEngine(options: { apiKey?: string; screening?: 'openai-and-context' | 'gemini-only'; contextAuthorized: boolean; maxRequests: number; geminiKey?: string; geminiFreeProjectConfirmed?: boolean; reserveRequest?: () => void; fetcher?: typeof fetch; observe?: (result: Assessment) => void }) {
    const screening=options.screening||'openai-and-context';
    if (!['openai-and-context','gemini-only'].includes(screening) || (screening==='openai-and-context'&&(!options.apiKey||/[\r\n]/.test(options.apiKey)))
        || (screening==='gemini-only'&&(!options.geminiKey||/[\r\n]/.test(options.geminiKey)||!options.geminiFreeProjectConfirmed))
        || !Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 10_000) throw new Error('Managed moderation configuration required');
    const fetcher = options.fetcher || fetch;
    let remaining = options.maxRequests;
    async function post(path: 'moderations' | 'responses' | 'gemini', payload: object, signal?: AbortSignal): Promise<unknown> {
        checkAbort(signal);
        if (screening==='gemini-only' && path!=='gemini') throw new ManagedModerationError('context_not_authorized');
        if (path === 'responses' && !options.contextAuthorized) throw new ManagedModerationError('context_not_authorized');
        if (path === 'gemini' && (!options.geminiKey || !options.geminiFreeProjectConfirmed)) throw new ManagedModerationError('context_not_authorized');
        if (remaining-- <= 0) throw new ManagedModerationError('request_budget_exhausted');
        options.reserveRequest?.();
        const deadline = AbortSignal.timeout(20_000), abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
        let response: Response;
        try { response = await fetcher(path === 'gemini' ? `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` : `https://api.openai.com/v1/${path}`, { method: 'POST', redirect: 'error', signal: abort,
            headers: path === 'gemini' ? { 'x-goog-api-key': options.geminiKey!, 'content-type': 'application/json' } : { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
        catch { throw new ManagedModerationError('provider_unavailable'); }
        if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) { await response.body?.cancel(); throw new ManagedModerationError('provider_unavailable', response.status, path); }
        const reader = response.body?.getReader(); if (!reader) throw new ManagedModerationError('provider_schema');
        const chunks: Uint8Array[] = []; let length = 0;
        try { while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length; if (length > 128 * 1024) throw new ManagedModerationError('provider_schema'); chunks.push(item.value); } }
        finally { await reader.cancel().catch(() => {}); }
        checkAbort(abort);
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw new ManagedModerationError('provider_schema'); }
    }
    async function inspectBatch(frames: Uint8Array[], prompt: string, signal?: AbortSignal): Promise<Decision> {
        const images = frames.map(bytes => Buffer.from(bytes).toString('base64'));
        if(screening==='gemini-only') {
            const result=geminiVerdict(await post('gemini',geminiPayload(images,prompt),signal));
            options.observe?.(result);return result.decision;
        }
        let result = managedVerdict(await post('moderations', { model: MANAGED_MODELS.moderation,
            input: [{ type: 'text', text: prompt }, ...images.map(image => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } }))] }, signal));
        if (result.decision === 'allow') {
            if (options.geminiKey && options.geminiFreeProjectConfirmed) {
                result = geminiVerdict(await post('gemini', geminiPayload(images, prompt), signal));
            } else {
            if (!options.contextAuthorized) throw new ManagedModerationError('context_not_authorized');
            const keys = ['safe', 'sexual', 'sexualMinors', 'nonConsensual', 'graphicAbuse', 'uncertain'];
            result = contextVerdict(await post('responses', { model: MANAGED_MODELS.context, store: false, max_output_tokens: 384,
                reasoning: { effort: 'none' }, instructions: `${POLICY}\nInspect EVERY supplied image; do not approve if any is unsafe or uncertain.`,
                input: [{ role: 'user', content: [{ type: 'input_text', text: `Quoted proposed action: ${quoteAction(prompt)}` }, ...images.map(image => ({ type: 'input_image', image_url: `data:image/png;base64,${image}`, detail: 'high' }))] }],
                text: { format: { type: 'json_schema', name: 'content_safety', strict: true,
                    schema: { type: 'object', properties: Object.fromEntries(keys.map(k => [k, { type: 'boolean' }])), required: keys, additionalProperties: false } } }
            }, signal));
            }
        }
        options.observe?.(result); return result.decision;
    }
    return {
        // Evaluation only. This screening result deliberately cannot satisfy
        // input()/output(), which also require the contextual assessment.
        screenOnly: async (image: string, prompt: string, signal?: AbortSignal) => {
            if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1024) throw new Error('Invalid prompt');
            const bytes = await png(image); checkAbort(signal);
            return managedVerdict(await post('moderations', { model: MANAGED_MODELS.moderation,
                input: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }] }, signal));
        },
        input: async (image: string, prompt: string, signal?: AbortSignal) => {
            if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1024) throw new Error('Invalid prompt');
            const bytes = await png(image); checkAbort(signal);
            return { decision: await inspectBatch([bytes], prompt, signal), decodeComplete: true };
        },
        output: (video: string, signal?: AbortSignal) => inspectVideo(video, (frame, abort) => inspectBatch([frame], 'Classify this video frame under the same safety policy.', abort), signal,
            (frames, abort) => inspectBatch(frames, 'Classify EVERY video frame under the same safety policy.', abort),
            {frames:screening==='gemini-only'?64:8,bytes:8*1024*1024}),
        remainingRequests: () => Math.max(0, remaining)
    };
}
