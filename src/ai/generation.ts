import { fetchGpuQuota } from './quota';
import { preparedImageSize } from './images';
import { validateImage } from './image-input';
import { normalizeImage } from '../security/images';
import { moderateInput, validatePrompt, type ModerationConfig } from '../security/moderation';
import { approvedProvider, verifyProviderIdentity, verifyWanParameters, verifyPinnedProvider, ProviderTrustError, type ProviderIdentity } from './provider-trust';
import { boundedJson } from '../server/body';
import { GradioProviderError as AiProviderError, readQueueResult } from './gradio';
import { logAiEvent, type AiTelemetry } from './telemetry';
import type { AiProgress } from '../shared/generation';
import { buildVideoPrompt, VIDEO_NEGATIVE_PROMPT } from '../shared/video-prompt';
import { officialPermit, requireOfficialRecipe } from './official-producer';
export { buildVideoPrompt } from '../shared/video-prompt';
import { Provider, ProviderConfig, DEFAULT_PROVIDER_CHAIN, parseProviderChain, videoDuration, providerName, providerSpace, providerEndpoint, providerSteps, providerGpuSeconds } from './providers';
export { DEFAULT_PROVIDER_CHAIN, parseProviderChain } from './providers';

export interface AiConfig extends ProviderConfig, ModerationConfig {
    WAN_PRODUCER_SECRET?: string;
    AI_PROVIDER?: string;
    AI_PROVIDER_CHAIN?: string;
    HF_TOKEN?: string;
    HF_SPACE_ID?: string;
    HF_PREDICT_ENDPOINT?: string;
    LTX_DURATION?: string;
    LTX_HEIGHT?: string;
    LTX_WIDTH?: string;
    LTX_GUIDANCE?: string;
    LTX_FRAMES?: string;
    LTX_ENHANCE_PROMPT?: string;
}

export { MAX_IMAGE_BYTES, validateImage } from './image-input';
export const AI_JOB_MAX_AGE_MS = 15 * 60_000;
export const AI_RETRY_MS = 15_000;
export interface AiJob {
    providerIdentity?: ProviderIdentity;
    provider: Provider;
    root: string;
    endpoint: string;
    eventId?: string;
    sessionHash?: string;
    submittedAt: number;
    status: 'submitting' | 'running' | 'complete' | 'failed';
    seed: number;
    steps: number;
    durationSeconds: number;
    videoUrl?: string;
}
export interface AiLifecycle {
    saveJob?(job: AiJob): Promise<void>;
    context?: AiTelemetry;
    resultTimeoutMs?: number;
}
export class AiPendingError extends Error {
    constructor(public job: AiJob) { super('Die Videoerstellung läuft noch. Der bestehende Auftrag wird erneut abgefragt.'); }
}
export class AiExpiredError extends Error {
    constructor() { super('Der KI-Auftrag konnte nicht wiederhergestellt werden. Bitte versuche es später erneut.'); }
}
class AiHttpError extends Error {
    constructor(public status: number) { super(`Hugging Face HTTP ${status}`); }
}
const HF_SPACE_ROOT = /^https:\/\/[a-z0-9-]+\.hf\.space(?:\/--replicas\/[a-z0-9][a-z0-9-]{0,79})?$/;
const jobFields = (job: AiJob, lifecycle: AiLifecycle) => ({ ...lifecycle.context, provider: job.provider,
    steps: job.steps, durationSeconds: job.durationSeconds, elapsedMs: Math.max(0, Date.now() - job.submittedAt) });
interface ApiParameter {
    parameter_name: string;
    parameter_has_default: boolean;
    parameter_default: unknown;
    type: { description?: string; enum?: unknown[] };
}


export function extractVideoUrl(result: unknown, root: string): string {
    const data = result as { data?: unknown[] };
    const first = data?.data?.[0] ?? result;
    const item = first as { video?: { url?: string; path?: string }; url?: string; path?: string };
    const file = item?.video ?? item;
    const value = typeof first === 'string' ? first : file?.url || (file?.path ? `${root}/gradio_api/file=${file.path}` : '');
    if (!value) throw new Error('KI hat keine Video-URL zurückgegeben.');
    const url = new URL(value, `${root}/`);
    if (url.protocol !== 'https:') throw new Error('KI hat eine ungültige Video-URL geliefert.');
    const source = new URL(root);
    // Gradio returns origin-only file URLs even when the job is pinned to a replica.
    if (HF_SPACE_ROOT.test(root) && source.pathname !== '/' && url.origin === source.origin && !url.pathname.startsWith('/--replicas/')) {
        url.pathname = source.pathname + url.pathname;
    }
    return url.href;
}

export function parseServerSentResult(body: string): { data: unknown[] } {
    for (const block of body.replace(/\r\n/g, '\n').split('\n\n')) {
        const lines = block.split('\n');
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (event === 'error') throw new AiProviderError('Der KI-Provider hat die Generierung abgebrochen.');
        if (event === 'complete') {
            const data: unknown = JSON.parse(raw);
            if (!Array.isArray(data)) throw new Error('Hugging Face lieferte kein Video-Ergebnis.');
            return { data };
        }
    }
    throw new Error('Hugging Face hat die Generierung nicht abgeschlossen.');
}

export function buildProviderValues(provider: Provider, prompt: string, image: unknown, config: AiConfig): Record<string, unknown> {
    const seed = Math.floor(Math.random() * 2_147_483_647);
    const duration = videoDuration(config);
    if (provider === 'wan22-official') return { input_image: image, prompt: buildVideoPrompt(prompt), seed, steps: 50, duration_seconds: 5, permit: '' };
    if (provider === 'ltx') return {
        prompt: buildVideoPrompt(prompt), negative_prompt: VIDEO_NEGATIVE_PROMPT,
        input_image_filepath: image, input_video_filepath: null,
        height_ui: Number(config.LTX_HEIGHT) || 512, width_ui: Number(config.LTX_WIDTH) || 704,
        mode: 'image-to-video', duration_ui: duration,
        // This parameter controls input-video frames, not output length.
        ui_frames_to_use: 9, seed_ui: seed, randomize_seed: false,
        ui_guidance_scale: Number(config.LTX_GUIDANCE) || 1, improve_texture_flag: true
    };
    return {
        input_image: image, last_image: null, prompt: buildVideoPrompt(prompt),
        height: 512, width: 896, negative_prompt: VIDEO_NEGATIVE_PROMPT,
        duration_seconds: duration, steps: providerSteps(provider),
        guidance_scale: 1, guidance_scale_2: 1, seed, randomize_seed: false,
        quality: 5, scheduler: 'UniPCMultistep', flow_shift: 3,
        frame_multiplier: 16, safe_mode: false, video_component: true
    };
}

export function orderProviderValues(parameters: ApiParameter[], values: Record<string, unknown>) {
    return parameters.map(parameter => {
        const value = values[parameter.parameter_name];
        if (value === undefined) {
            if (!parameter.parameter_has_default) throw new Error(`KI-Schnittstelle geändert: ${parameter.parameter_name}`);
            return parameter.parameter_default;
        }
        const range = /between ([\d.]+) and ([\d.]+)/.exec(parameter.type.description || '');
        if (typeof value === 'number' && range && (value < Number(range[1]) || value > Number(range[2]))) {
            throw new Error(`${parameter.parameter_name}: ${value} liegt außerhalb des unterstützten Bereichs.`);
        }
        if (parameter.type.enum && !parameter.type.enum.includes(value)) throw new Error(`Ungültiger KI-Parameter: ${parameter.parameter_name}`);
        return value;
    });
}

export async function resumeAiVideo(job: AiJob, config: AiConfig, progress: AiProgress = () => {}, lifecycle: AiLifecycle = {}) {
    if (!HF_SPACE_ROOT.test(job.root) || !/^\/[a-zA-Z0-9_-]+$/.test(job.endpoint)
        || (job.eventId && !/^[a-zA-Z0-9_-]{1,120}$/.test(job.eventId))
        || (job.sessionHash && !/^[a-zA-Z0-9_-]{1,120}$/.test(job.sessionHash))) throw new Error('Ungültiger gespeicherter KI-Auftrag.');
    if (job.status === 'complete' && job.videoUrl) return job.videoUrl;
    if (job.status === 'failed') throw new AiProviderError('Der KI-Provider hat die Generierung abgebrochen.');
    if (Date.now() - job.submittedAt >= AI_JOB_MAX_AGE_MS) {
        logAiEvent('expired', { ...jobFields(job, lifecycle), errorCode: 'status_unknown' });
        throw new AiExpiredError();
    }
    // A lost POST response is ambiguous. Never issue another GPU job blindly.
    if (!job.eventId) throw new AiPendingError(job);
    const verify = async () => {
        if (config.AI_PROVIDER === 'mock') return;
        if (!job.providerIdentity) throw new ProviderTrustError();
        await verifyPinnedProvider(job.providerIdentity, job.root, async url => {
            const response = await fetch(url, { redirect: 'manual', headers: config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {}, signal: AbortSignal.timeout(15_000) });
            if (!response.ok) { await response.body?.cancel(); throw new ProviderTrustError(); }
            return boundedJson(response, 512 * 1024);
        });
    };
    progress('Videoerstellung wird fortgesetzt...', 'result');
    logAiEvent('result_requested', jobFields(job, lifecycle));
    try {
        await verify();
        const resultUrl = job.sessionHash ? `${job.root}/gradio_api/queue/data?session_hash=${encodeURIComponent(job.sessionHash)}`
            : `${job.root}/gradio_api/call${job.endpoint}/${job.eventId}`;
        const response = await fetch(resultUrl, {
            redirect: 'manual',
            headers: config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {},
            signal: AbortSignal.timeout(lifecycle.resultTimeoutMs || 180_000)
        });
        if (!response.ok) throw new AiHttpError(response.status);
        const result = job.sessionHash ? await readQueueResult(response, job.eventId, progress) : parseServerSentResult(await response.text());
        const videoUrl = extractVideoUrl(result, job.root);
        await verify();
        const completed: AiJob = { ...job, status: 'complete', videoUrl };
        await lifecycle.saveJob?.(completed);
        logAiEvent('completed', jobFields(completed, lifecycle));
        return videoUrl;
    } catch (error) {
        if (error instanceof AiProviderError) {
            await lifecycle.saveJob?.({ ...job, status: 'failed' });
            logAiEvent('failed', { ...jobFields(job, lifecycle), stage: 'result', errorCode: error.code });
            throw error;
        }
        logAiEvent('retrieval_retry', { ...jobFields(job, lifecycle), stage: 'result', httpStatus: error instanceof AiHttpError ? error.status : undefined, errorCode: error instanceof AiHttpError ? `http_${error.status}` : 'connection_or_result_incomplete' });
        throw new AiPendingError(job);
    }
}

export async function generateAiVideo(imageBase64: string, prompt: string, config: AiConfig, progress: AiProgress = () => {}, allowAttempt?: (seconds: number) => Promise<void>, lifecycle: AiLifecycle = {}) {
    prompt = validatePrompt(prompt);
    imageBase64 = await normalizeImage(imageBase64);
    await moderateInput(imageBase64, buildVideoPrompt(prompt), config);
    const image = validateImage(imageBase64);
    const size = config.AI_IMAGE_PROFILE === 'bounded' ? preparedImageSize(image.base64) : undefined;
    if (config.AI_PROVIDER === 'mock') {
        await new Promise(resolve => setTimeout(resolve, 200));
        return '/assets/mock-video.mp4';
    }
    approvedProvider(config);
    const official = parseProviderChain(config.AI_PROVIDER_CHAIN || config.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN).includes('wan22-official');
    if (official) {
        requireOfficialRecipe(config);
        if (parseProviderChain(config.AI_PROVIDER_CHAIN || config.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN).length !== 1) throw new ProviderTrustError();
    }
    let subject: string | undefined;
    if (config.HF_TOKEN) {
        const response = await fetch('https://huggingface.co/api/whoami-v2', {
            headers: { Authorization: `Bearer ${config.HF_TOKEN}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000)
        });
        if (response.status === 401 || response.status === 403) throw new Error('Der Hugging-Face-Zugang ist ungültig oder abgelaufen. Bitte die persönliche HF-Verbindung oder den Serverzugang erneuern.');
        if (!response.ok) throw new Error('Hugging-Face-Anmeldung ist momentan nicht erreichbar.');
        if (official) {
            const identity = await boundedJson(response, 64 * 1024) as { id?: unknown };
            if (typeof identity.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.id)) throw new ProviderTrustError();
            subject = identity.id;
        } else await response.body?.cancel();
    }
    if (official && !subject) throw new ProviderTrustError();
    const errors: string[] = [];
    let providerError: AiProviderError | undefined;
    let attempt = 0;
    for (const provider of parseProviderChain(config.AI_PROVIDER_CHAIN || config.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN)) {
        attempt++;
        let job: AiJob | undefined;
        let stage: NonNullable<AiTelemetry['stage']> = 'quota';
        const startedAt = Date.now();
        logAiEvent('attempt', { ...lifecycle.context, provider, attempt, steps: providerSteps(provider), durationSeconds: videoDuration(config) });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 180_000);
        try {
            const needed = providerGpuSeconds(provider, config, provider.startsWith('wan22') ? size : undefined);
            if (!Number.isFinite(needed)) throw new Error('Dieser Space unterstützt keine Videos mit mindestens 5 Sekunden.');
            const quota = await fetchGpuQuota(config);
            if (quota.current < needed || quota.runs?.remaining === 0) throw new Error('Das kostenlose GPU-Kontingent ist aufgebraucht.');
            const space = providerSpace(provider, config);
            const headers: Record<string, string> = config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {};
            const get = async (url: string, init?: RequestInit) => {
                const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal, headers: { ...headers, ...init?.headers } });
                if (!response.ok) throw new AiHttpError(response.status);
                return response;
            };
            stage = 'metadata';
            const metadata = await boundedJson(await get(`https://huggingface.co/api/spaces/${space}`), 512 * 1024) as { host?: string };
            if (!metadata.host || !/^https:\/\/[a-z0-9-]+\.hf\.space$/.test(metadata.host)) throw new Error('Space ist nicht erreichbar.');
            let root = metadata.host;
            const endpoint = providerEndpoint(provider, config);
            stage = 'configuration';
            const infoResponse = await get(`${root}/gradio_api/info`);
            const replica = infoResponse.headers.get('x-proxied-replica');
            // Uploads, queue state and generated files are local to the selected replica.
            if (replica && /^[a-z0-9][a-z0-9-]{0,79}$/.test(replica)) root += `/--replicas/${replica}`;
            const info = await boundedJson(infoResponse, 512 * 1024) as { named_endpoints: Record<string, { parameters: ApiParameter[] }> };
            const parameters = info.named_endpoints[endpoint]?.parameters;
            if (!parameters) throw new Error('Space bietet den erwarteten Video-Endpunkt nicht an.');
            const queue = provider === 'wan22' || provider === 'wan22-fast' || provider === 'wan22-official';
            let fnIndex: number | undefined;
            let providerIdentity: ProviderIdentity | undefined;
            if (queue) {
                const settings = await boundedJson(await get(`${root}/config`), 512 * 1024) as { dependencies?: { id?: number; api_name?: string }[] };
                fnIndex = settings.dependencies?.find(dependency => dependency.api_name === endpoint.slice(1))?.id;
                if (typeof fnIndex !== 'number' || !Number.isInteger(fnIndex) || fnIndex < 0) throw new Error('Space bietet die erwartete Video-Queue nicht an.');
                providerIdentity = verifyProviderIdentity(config, metadata, settings);
                verifyWanParameters(parameters, buildProviderValues(provider, prompt, null, config));
            }
            else throw new ProviderTrustError();
            // Validate before uploading, including the requested minimum duration.
            orderProviderValues(parameters, buildProviderValues(provider, prompt, null, config));
            await allowAttempt?.(needed);
            progress(`${providerName(provider)} erstellt das Video...`, 'preparing');
            const bytes = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0));
            const form = new FormData();
            const filename = `input.${image.mime.split('/')[1]}`;
            form.append('files', new Blob([bytes], { type: image.mime }), filename);
            stage = 'upload';
            const uploaded = await boundedJson(await get(`${root}/gradio_api/upload`, { method: 'POST', body: form }), 16_384) as unknown;
            if (!Array.isArray(uploaded) || uploaded.length !== 1 || typeof uploaded[0] !== 'string' || !uploaded[0] || uploaded[0].length > 4096 || /[\p{Cc}\p{Cf}]/u.test(uploaded[0])) throw new Error('Hugging Face hat keinen gültigen Upload-Pfad geliefert.');
            // Upload can outlast a deployment. Recheck before the irreversible
            // generation POST; do not silently run a newly merged model.
            await verifyPinnedProvider(providerIdentity!, root, async url => boundedJson(await get(url), 512 * 1024));
            const file = { path: uploaded[0], orig_name: filename, mime_type: image.mime, meta: { _type: 'gradio.FileData' } };
            const values = buildProviderValues(provider, prompt, file, config);
            if (provider === 'wan22-official') values.permit = await officialPermit(config.WAN_PRODUCER_SECRET!, subject!, bytes, String(values.prompt), Number(values.seed));
            const data = orderProviderValues(parameters, values);
            job = { provider, providerIdentity, root, endpoint, submittedAt: Date.now(), status: 'submitting',
                ...(queue ? { sessionHash: crypto.randomUUID() } : {}),
                seed: Number(data[parameters.findIndex(p => p.parameter_name === 'seed')]) || 0,
                steps: providerSteps(provider), durationSeconds: videoDuration(config) };
            await lifecycle.saveJob?.(job);
            stage = 'submit';
            const started = await boundedJson(await get(`${root}/gradio_api/${queue ? 'queue/join' : `call${endpoint}`}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(queue ? { data, fn_index: fnIndex, session_hash: job.sessionHash } : { data })
            }), 16_384) as { event_id?: string };
            // A malformed POST response is ambiguous, just like a lost one.
            // Keep the persisted submitting job; never bind an unusable ID or
            // blindly repeat the GPU submission.
            if (typeof started?.event_id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(started.event_id)) throw new Error('Hugging Face hat keine gültige Event-ID geliefert.');
            job = { ...job, eventId: started.event_id, status: 'running' };
            await lifecycle.saveJob?.(job);
            logAiEvent('submitted', { ...jobFields(job, lifecycle), attempt });
            stage = 'result';
            return await resumeAiVideo(job, config, progress, lifecycle);
        } catch (error) {
            if (error instanceof ProviderTrustError) throw error;
            if (error instanceof AiPendingError || error instanceof AiExpiredError) throw error;
            if (job?.status === 'submitting' && !(error instanceof AiHttpError && error.status >= 400 && error.status < 500)) throw new AiPendingError(job);
            if (job?.status === 'running' && !(error instanceof AiProviderError)) throw new AiPendingError(job);
            if (job) await lifecycle.saveJob?.({ ...job, status: 'failed' });
            if (error instanceof AiProviderError) providerError = error;
            errors.push(provider);
            logAiEvent('attempt_failed', { ...lifecycle.context, provider, attempt, stage, httpStatus: error instanceof AiHttpError ? error.status : undefined, elapsedMs: Date.now() - startedAt,
                errorCode: error instanceof AiHttpError ? `http_${error.status}` : error instanceof AiProviderError ? error.code : job ? 'provider_error' : 'preflight_or_budget' });
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`Alle kostenlosen KI-Provider sind derzeit nicht verfügbar (${errors.join(', ')}). ${providerError?.message || 'Bitte versuche es später erneut.'}`);
}
