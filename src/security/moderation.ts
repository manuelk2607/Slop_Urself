import { boundedJson } from '../server/body';

export interface ModerationConfig {
    AI_PROVIDER?: string;
    MODERATION_URL?: string;
    MODERATION_SECRET?: string;
    MODERATION_POLICY_VERSION?: string;
    MODERATION_MODEL_VERSION?: string;
}
export class ModerationError extends Error {
    constructor(readonly code: 'moderation_unavailable' | 'content_blocked' | 'content_review', message: string) { super(message); }
}
const unavailable = () => new ModerationError('moderation_unavailable', 'Die Inhaltsprüfung ist noch nicht eingerichtet oder vorübergehend nicht erreichbar. Es wird kein neuer KI-Auftrag gestartet.');
const approvals = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

export function moderationConfigured(config: ModerationConfig) {
    try {
        const url = new URL(config.MODERATION_URL || '');
        return url.protocol === 'https:' && url.pathname.endsWith('/validate') && !url.username && !url.password && !url.search && !url.hash
            && Boolean(config.MODERATION_SECRET && config.MODERATION_SECRET.length >= 32 && config.MODERATION_POLICY_VERSION && config.MODERATION_MODEL_VERSION);
    } catch { return false; }
}
export function generationSafetyReady(config: ModerationConfig) {
    if (config.AI_PROVIDER !== 'mock' && !moderationConfigured(config)) throw unavailable();
}
async function sha256(bytes: Uint8Array) {
    const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
function base64(bytes: Uint8Array) {
    let text = ''; for (let start = 0; start < bytes.length; start += 16384) text += String.fromCharCode(...bytes.subarray(start, start + 16384));
    return btoa(text);
}
interface Verdict {
    evaluationOnly?: unknown;
    decision?: unknown; digest?: unknown; policyVersion?: unknown; modelVersion?: unknown;
    decodeComplete?: unknown; frameCount?: unknown; framesChecked?: unknown; durationSeconds?: unknown;
    codec?: unknown; pixelFormat?: unknown;
}
async function evaluate(stage: 'input' | 'output', payload: Record<string, unknown>, config: ModerationConfig) {
    if (config.AI_PROVIDER === 'mock') return;
    generationSafetyReady(config);
    const body = JSON.stringify({ stage, policyVersion: config.MODERATION_POLICY_VERSION, modelVersion: config.MODERATION_MODEL_VERSION, ...payload });
    const digest = await sha256(new TextEncoder().encode(body));
    const key = `${config.MODERATION_URL}:${digest}`;
    for (const [id, expiry] of approvals) if (expiry <= Date.now()) approvals.delete(id);
    if ((approvals.get(key) || 0) > Date.now()) return;
    const pending = inFlight.get(key); if (pending) return pending;
    if (inFlight.size >= 16) throw unavailable();
    const work = (async () => {
        let verdict: Verdict;
        try {
            const response = await fetch(config.MODERATION_URL!, { method: 'POST', redirect: 'error',
                headers: { authorization: `Bearer ${config.MODERATION_SECRET}`, 'content-type': 'application/json', 'x-content-sha256': digest },
                body, signal: AbortSignal.timeout(30_000) });
            if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw unavailable();
            verdict = await boundedJson(response, 16_384) as Verdict;
        } catch { throw unavailable(); }
        if (!verdict || verdict.evaluationOnly !== undefined || verdict.digest !== digest || verdict.policyVersion !== config.MODERATION_POLICY_VERSION || verdict.modelVersion !== config.MODERATION_MODEL_VERSION) throw unavailable();
        if (verdict.decision === 'block') throw new ModerationError('content_blocked', 'Dieser Inhalt kann nach den Spielregeln nicht verarbeitet werden. Bitte wähle ein anderes Bild oder einen anderen Prompt.');
        if (verdict.decision === 'review') throw new ModerationError('content_review', 'Dieser Inhalt konnte nicht sicher freigegeben werden. Bitte wähle ein anderes Motiv oder wende dich an den Spielbesitzer.');
        if (verdict.decision !== 'allow' || verdict.decodeComplete !== true) throw unavailable();
        if (stage === 'output' && (!Number.isInteger(verdict.frameCount) || Number(verdict.frameCount) < 1 || Number(verdict.frameCount) > 1200
            || verdict.framesChecked !== verdict.frameCount || typeof verdict.durationSeconds !== 'number' || verdict.durationSeconds < 5 || verdict.durationSeconds > 9
            || verdict.codec !== 'h264' || verdict.pixelFormat !== 'yuv420p')) throw unavailable();
        if (approvals.size >= 64) approvals.delete(approvals.keys().next().value!);
        approvals.set(key, Date.now() + 120_000);
    })();
    inFlight.set(key, work);
    try { await work; } finally { inFlight.delete(key); }
}

// Deliberately not a keyword-based promise of semantic safety: the reviewed
// service must jointly classify the actual image and the exact submitted text.
export async function moderateInput(image: string, prompt: string, config: ModerationConfig) {
    return evaluate('input', { image, prompt }, config);
}
export async function moderateOutput(bytes: Uint8Array, config: ModerationConfig) {
    return evaluate('output', { video: base64(bytes), mime: 'video/mp4' }, config);
}
export function validatePrompt(value: unknown) {
    if (typeof value !== 'string') throw new Error('Bitte gib einen Prompt ein.');
    const prompt = value.normalize('NFKC').trim();
    if (!prompt || prompt.length > 150 || /[\p{Cc}\p{Cf}]/u.test(prompt)) throw new Error('Bitte gib einen Prompt mit 1 bis 150 sichtbaren Zeichen ein.');
    return prompt;
}
