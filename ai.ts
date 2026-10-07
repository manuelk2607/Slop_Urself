import { fetchGpuQuota } from './quota';
import { logAiEvent, type AiTelemetry } from './telemetry';
import { Provider, ProviderConfig, DEFAULT_PROVIDER_CHAIN, parseProviderChain, videoDuration, providerName, providerSpace, providerEndpoint, providerSteps, providerGpuSeconds } from './providers';
export { DEFAULT_PROVIDER_CHAIN, parseProviderChain } from './providers';

export interface AiConfig extends ProviderConfig {
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

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const AI_JOB_MAX_AGE_MS = 15 * 60_000;
export const AI_RETRY_MS = 15_000;
export interface AiJob {
    provider: Provider;
    root: string;
    endpoint: string;
    eventId?: string;
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
    constructor(public job: AiJob) { super('Die Videoerstellung laeuft noch. Der bestehende Auftrag wird erneut abgefragt.'); }
}
export class AiExpiredError extends Error {
    constructor() { super('Der KI-Auftrag konnte nicht wiederhergestellt werden. Bitte versuche es spaeter erneut.'); }
}
class AiProviderError extends Error {}
class AiHttpError extends Error {
    constructor(public status: number) { super(`Hugging Face HTTP ${status}`); }
}
const jobFields = (job: AiJob, lifecycle: AiLifecycle) => ({ ...lifecycle.context, provider: job.provider,
    steps: job.steps, durationSeconds: job.durationSeconds, elapsedMs: Math.max(0, Date.now() - job.submittedAt) });
interface ApiParameter {
    parameter_name: string;
    parameter_has_default: boolean;
    parameter_default: unknown;
    type: { description?: string; enum?: unknown[] };
}

export function validateImage(value: unknown): { mime: string; base64: string } {
    if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 100) {
        throw new Error('Bitte nutze ein Bild bis maximal 8 MB.');
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) {
        throw new Error('Bitte lade ein gueltiges PNG-, JPEG- oder WebP-Bild hoch.');
    }
    const bytes = atob(match[2]);
    const valid = match[1] === 'image/png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
        : match[1] === 'image/jpeg' ? bytes.startsWith('\xff\xd8\xff')
        : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
    if (!valid || bytes.length > MAX_IMAGE_BYTES) throw new Error('Die Bilddatei ist ungueltig oder zu gross.');
    return { mime: match[1], base64: match[2] };
}

export function buildVideoPrompt(prompt: string) {
    return `${prompt.trim()}. The action happens visibly in the scene. Preserve the subject's appearance and the original setting. Continuous natural movement, one shot.`;
}

const NEGATIVE_PROMPT = 'blurry, distorted, frozen subject, still image, flickering, extra limbs, deformed face, watermark';

export function extractVideoUrl(result: unknown, root: string): string {
    const data = result as { data?: unknown[] };
    const first = data?.data?.[0] ?? result;
    const item = first as { video?: { url?: string; path?: string }; url?: string; path?: string };
    const file = item?.video ?? item;
    const value = typeof first === 'string' ? first : file?.url || (file?.path ? `${root}/gradio_api/file=${file.path}` : '');
    if (!value) throw new Error('KI hat keine Video-URL zurueckgegeben.');
    const url = new URL(value, root);
    if (url.protocol !== 'https:') throw new Error('KI hat eine ungueltige Video-URL geliefert.');
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
    if (provider === 'ltx') return {
        prompt: buildVideoPrompt(prompt), negative_prompt: NEGATIVE_PROMPT,
        input_image_filepath: image, input_video_filepath: null,
        height_ui: Number(config.LTX_HEIGHT) || 512, width_ui: Number(config.LTX_WIDTH) || 704,
        mode: 'image-to-video', duration_ui: duration,
        // This parameter controls input-video frames, not output length.
        ui_frames_to_use: 9, seed_ui: seed, randomize_seed: false,
        ui_guidance_scale: Number(config.LTX_GUIDANCE) || 1, improve_texture_flag: true
    };
    return {
        input_image: image, last_image: null, prompt: buildVideoPrompt(prompt),
        height: 512, width: 896, negative_prompt: NEGATIVE_PROMPT,
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
            if (!parameter.parameter_has_default) throw new Error(`KI-Schnittstelle geaendert: ${parameter.parameter_name}`);
            return parameter.parameter_default;
        }
        const range = /between ([\d.]+) and ([\d.]+)/.exec(parameter.type.description || '');
        if (typeof value === 'number' && range && (value < Number(range[1]) || value > Number(range[2]))) {
            throw new Error(`${parameter.parameter_name}: ${value} liegt ausserhalb des unterstuetzten Bereichs.`);
        }
        if (parameter.type.enum && !parameter.type.enum.includes(value)) throw new Error(`Ungueltiger KI-Parameter: ${parameter.parameter_name}`);
        return value;
    });
}

export async function resumeAiVideo(job: AiJob, config: AiConfig, progress: (step: string) => void = () => {}, lifecycle: AiLifecycle = {}) {
    if (!/^https:\/\/[a-z0-9-]+\.hf\.space$/.test(job.root) || !/^\/[a-zA-Z0-9_-]+$/.test(job.endpoint)
        || (job.eventId && !/^[a-zA-Z0-9_-]{1,120}$/.test(job.eventId))) throw new Error('Ungueltiger gespeicherter KI-Auftrag.');
    if (job.status === 'complete' && job.videoUrl) return job.videoUrl;
    if (job.status === 'failed') throw new AiProviderError('Der KI-Provider hat die Generierung abgebrochen.');
    if (Date.now() - job.submittedAt >= AI_JOB_MAX_AGE_MS) {
        logAiEvent('expired', { ...jobFields(job, lifecycle), errorCode: 'status_unknown' });
        throw new AiExpiredError();
    }
    // A lost POST response is ambiguous. Never issue another GPU job blindly.
    if (!job.eventId) throw new AiPendingError(job);
    progress('Videoerstellung wird fortgesetzt...');
    logAiEvent('result_requested', jobFields(job, lifecycle));
    try {
        const response = await fetch(`${job.root}/gradio_api/call${job.endpoint}/${job.eventId}`, {
            headers: config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {},
            signal: AbortSignal.timeout(lifecycle.resultTimeoutMs || 180_000)
        });
        if (!response.ok) throw new AiHttpError(response.status);
        const videoUrl = extractVideoUrl(parseServerSentResult(await response.text()), job.root);
        const completed: AiJob = { ...job, status: 'complete', videoUrl };
        await lifecycle.saveJob?.(completed);
        logAiEvent('completed', jobFields(completed, lifecycle));
        return videoUrl;
    } catch (error) {
        if (error instanceof AiProviderError) {
            await lifecycle.saveJob?.({ ...job, status: 'failed' });
            logAiEvent('failed', { ...jobFields(job, lifecycle), errorCode: 'provider_error' });
            throw error;
        }
        logAiEvent('retrieval_retry', { ...jobFields(job, lifecycle), errorCode: error instanceof AiHttpError ? `http_${error.status}` : 'connection_or_result_incomplete' });
        throw new AiPendingError(job);
    }
}

export async function generateAiVideo(imageBase64: string, prompt: string, config: AiConfig, progress: (step: string) => void = () => {}, allowAttempt?: (seconds: number) => Promise<void>, lifecycle: AiLifecycle = {}) {
    const image = validateImage(imageBase64);
    if (config.AI_PROVIDER === 'mock') {
        await new Promise(resolve => setTimeout(resolve, 200));
        return '/assets/mock-video.mp4';
    }
    if (config.HF_TOKEN) {
        const response = await fetch('https://huggingface.co/api/whoami-v2', {
            headers: { Authorization: `Bearer ${config.HF_TOKEN}` }, signal: AbortSignal.timeout(15_000)
        });
        if (response.status === 401 || response.status === 403) throw new Error('Der Hugging-Face-Token ist ungueltig. Bitte HF_TOKEN auf dem Server aktualisieren.');
        if (!response.ok) throw new Error('Hugging-Face-Anmeldung ist momentan nicht erreichbar.');
    }
    const errors: string[] = [];
    let attempt = 0;
    for (const provider of parseProviderChain(config.AI_PROVIDER_CHAIN || config.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN)) {
        attempt++;
        let job: AiJob | undefined;
        const startedAt = Date.now();
        logAiEvent('attempt', { ...lifecycle.context, provider, attempt, steps: providerSteps(provider), durationSeconds: videoDuration(config) });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 180_000);
        try {
            const needed = providerGpuSeconds(provider, config);
            if (!Number.isFinite(needed)) throw new Error('Dieser Space unterstuetzt keine Videos mit mindestens 5 Sekunden.');
            const quota = await fetchGpuQuota(config);
            if (quota.current < needed || quota.runs?.remaining === 0) throw new Error('Das kostenlose GPU-Kontingent ist aufgebraucht.');
            await allowAttempt?.(needed);
            progress(`${providerName(provider)} erstellt das Video...`);
            const space = providerSpace(provider, config);
            const headers: Record<string, string> = config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {};
            const get = async (url: string, init?: RequestInit) => {
                const response = await fetch(url, { ...init, signal: controller.signal, headers: { ...headers, ...init?.headers } });
                if (!response.ok) throw new AiHttpError(response.status);
                return response;
            };
            const metadata = await (await get(`https://huggingface.co/api/spaces/${space}`)).json() as { host?: string };
            if (!metadata.host || !/^https:\/\/[a-z0-9-]+\.hf\.space$/.test(metadata.host)) throw new Error('Space ist nicht erreichbar.');
            const root = metadata.host;
            const endpoint = providerEndpoint(provider, config);
            const info = await (await get(`${root}/gradio_api/info`)).json() as { named_endpoints: Record<string, { parameters: ApiParameter[] }> };
            const parameters = info.named_endpoints[endpoint]?.parameters;
            if (!parameters) throw new Error('Space bietet den erwarteten Video-Endpunkt nicht an.');
            // Validate before uploading, including the requested minimum duration.
            orderProviderValues(parameters, buildProviderValues(provider, prompt, null, config));
            const bytes = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0));
            const form = new FormData();
            const filename = `input.${image.mime.split('/')[1]}`;
            form.append('files', new Blob([bytes], { type: image.mime }), filename);
            const uploaded = await (await get(`${root}/gradio_api/upload`, { method: 'POST', body: form })).json() as string[];
            if (!uploaded[0]) throw new Error('Hugging Face hat keinen Upload-Pfad geliefert.');
            const file = { path: uploaded[0], orig_name: filename, mime_type: image.mime, meta: { _type: 'gradio.FileData' } };
            const data = orderProviderValues(parameters, buildProviderValues(provider, prompt, file, config));
            job = { provider, root, endpoint, submittedAt: Date.now(), status: 'submitting',
                seed: Number(data[parameters.findIndex(p => p.parameter_name === (provider === 'ltx' ? 'seed_ui' : 'seed'))]) || 0,
                steps: providerSteps(provider), durationSeconds: videoDuration(config) };
            await lifecycle.saveJob?.(job);
            const started = await (await get(`${root}/gradio_api/call${endpoint}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data })
            })).json() as { event_id?: string };
            if (!started.event_id) throw new Error('Hugging Face hat keine Event-ID geliefert.');
            job = { ...job, eventId: started.event_id, status: 'running' };
            await lifecycle.saveJob?.(job);
            logAiEvent('submitted', { ...jobFields(job, lifecycle), attempt });
            return await resumeAiVideo(job, config, progress, lifecycle);
        } catch (error) {
            if (error instanceof AiPendingError || error instanceof AiExpiredError) throw error;
            if (job?.status === 'submitting' && !(error instanceof AiHttpError && error.status >= 400 && error.status < 500)) throw new AiPendingError(job);
            if (job?.status === 'running' && !(error instanceof AiProviderError)) throw new AiPendingError(job);
            if (job) await lifecycle.saveJob?.({ ...job, status: 'failed' });
            errors.push(provider);
            logAiEvent('attempt_failed', { ...lifecycle.context, provider, attempt, elapsedMs: Date.now() - startedAt,
                errorCode: error instanceof AiHttpError ? `http_${error.status}` : job ? 'provider_error' : 'preflight_or_budget' });
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`Alle kostenlosen KI-Provider sind derzeit nicht verfuegbar (${errors.join(', ')}). Bitte versuche es spaeter erneut.`);
}
