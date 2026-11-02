import { imagePixelDigest } from './images';
import { buildVideoPrompt } from '../shared/video-prompt';
import type { AiConfig } from '../ai/generation';

// Operator-approved synthetic cases only. This is not general moderation
// qualification and cannot change the public release/configuration response.
export const VALIDATION_PAIR = [
    { pixelSha256: 'f6860b738a396c974dd4bf5dcb102d5bc1bab769c532e5afc4b74749226efa03', prompt: 'The yellow ball bounces gently in place. Static camera.', seed: 1 },
    { pixelSha256: '9ac5fd4a9da300556a44726fbf719441ca212627be9640965e2276951256c3d3', prompt: 'The red cube slowly rotates in place. Static camera.', seed: 2 }
] as const;
export const VALIDATION_PRODUCER_REVISION = 'c82855772dc0b82b22e8188ae59731bb262e9a49';
export interface ValidationMember { accountId: string; subject: string }
export interface ValidationCampaign {
    id: string; room: string; approvedAt: number; expiresAt: number;
    operatorApproval: 'fixed-pair-approved-2026-11-02';
    members: [ValidationMember, ValidationMember];
    moderatorUrl: string; moderatorVersion: string;
}
export interface ValidationScope { campaign: ValidationCampaign; jobId?: string; accountId?: string }
export interface ValidationConfig { LIVE_VALIDATION_CAMPAIGN?: string; liveValidation?: ValidationScope }
const scopes = new WeakSet<object>();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
export function parseValidationCampaign(value: string | undefined, now = Date.now()): ValidationCampaign | undefined {
    if (!value) return;
    try {
        if (value.length > 4096) return;
        const c = JSON.parse(value) as ValidationCampaign, url = new URL(c.moderatorUrl);
        if (!uuid(c.id) || !/^[A-Z0-9]{4}$/.test(c.room) || c.operatorApproval !== 'fixed-pair-approved-2026-11-02'
            || !Number.isSafeInteger(c.approvedAt) || !Number.isSafeInteger(c.expiresAt) || c.approvedAt > now
            || c.expiresAt <= now || c.expiresAt > c.approvedAt + 6 * 60 * 60_000
            || url.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)
            || url.pathname !== '/jobs/validate' || url.port || url.username || url.password || url.search || url.hash
            || !/^[a-f0-9]{64}$/.test(c.moderatorVersion) || !Array.isArray(c.members) || c.members.length !== 2
            || c.members.some(m => !m || !uuid(m.accountId) || !/^[A-Za-z0-9_-]{1,128}$/.test(m.subject))
            || new Set(c.members.map(m => m.accountId)).size !== 2 || new Set(c.members.map(m => m.subject)).size !== 2) return;
        return Object.freeze({ ...c, members: Object.freeze(c.members.map(m => Object.freeze({ ...m }))) }) as ValidationCampaign;
    } catch { return; }
}
export function validationScope(config: ValidationConfig, now = Date.now()) {
    const scope = config.liveValidation;
    return scope && scopes.has(scope) && scope.campaign.approvedAt <= now && scope.campaign.expiresAt > now ? scope : undefined;
}
export function validationConfig<T extends AiConfig & ValidationConfig>(env: T, code: string, job?: { id: string; accountId: string }): T {
    if (env.AI_PROVIDER === 'mock' || env.AI_GENERATION_RELEASE !== 'blocked') return env;
    const campaign = parseValidationCampaign(env.LIVE_VALIDATION_CAMPAIGN);
    if (!campaign || campaign.room !== code) return env;
    if (job && (!uuid(job.id) || !campaign.members.some(m => m.accountId === job.accountId))) throw new Error('Auftrag gehört nicht zur begrenzten Prüfung.');
    const scope: ValidationScope = Object.freeze({ campaign, ...(job ? { jobId: job.id, accountId: job.accountId } : {}) });
    scopes.add(scope);
    return { ...env, liveValidation: scope, AI_PROVIDER: 'wan22-official', AI_PROVIDER_CHAIN: 'wan22-official',
        AI_GPU_SECONDS_PER_ROUND: '120', AI_ROUND_LIMIT: '1', LTX_DURATION: '5', AI_IMAGE_PROFILE: 'bounded',
        WAN_SPACE_ID: 'Manuel2607/SlopUrself-Wan22-Validated', WAN_SPACE_REVISION: VALIDATION_PRODUCER_REVISION,
        WAN_MODEL_ID: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers', WAN_MODEL_REVISION: 'b8fff7315c768468a5333511427288870b2e9635',
        MODERATION_URL: campaign.moderatorUrl, MODERATION_MODEL_VERSION: campaign.moderatorVersion, MODERATION_POLICY_VERSION: 'slop-content-2026-10-25-v1' };
}
export function validationMember(scope: ValidationScope, accountId: string | undefined) {
    const index = scope.campaign.members.findIndex(m => m.accountId === accountId);
    if (index < 0) throw new Error('Dieses Konto gehört nicht zur begrenzten Prüfung.');
    return { ...scope.campaign.members[index], ...VALIDATION_PAIR[index] };
}
export async function validationInput(config: ValidationConfig, accountId: string | undefined, image: string, prompt: string) {
    const scope = validationScope(config); if (!scope) return;
    const member = validationMember(scope, accountId);
    if (buildVideoPrompt(prompt) !== buildVideoPrompt(member.prompt) || await imagePixelDigest(image, { width: 640, height: 640 }) !== member.pixelSha256) throw new Error('Für diese Prüfung sind ausschließlich die zwei bestätigten Bilder und Prompts freigegeben.');
    return member;
}
export async function digest(bytes: Uint8Array | string) {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, '0')).join('');
}
export interface ValidationAdmission { jobId: string; accountId: string; subject: string; pixelSha256: string; imageSha256: string; promptSha256: string; seed: number; claimed: boolean }
interface Storage { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> }
// Invoked only in the serialized Services security queue. No TTL pruning of a
// consumed slot: Space loss, permit expiry and new job UUIDs cannot buy retries.
export class ValidationLedger {
    constructor(private storage: Storage, private campaign: ValidationCampaign) {}
    private key() { return `live-validation:v1:${this.campaign.id}`; }
    async entries() { return await this.storage.get<ValidationAdmission[]>(this.key()) || []; }
    async admit(value: Omit<ValidationAdmission, 'claimed'>) {
        const scope = { campaign: this.campaign }, member = validationMember(scope, value.accountId);
        if (this.campaign.expiresAt <= Date.now() || !uuid(value.jobId) || value.subject !== member.subject || value.seed !== member.seed
            || value.pixelSha256 !== member.pixelSha256 || !/^[a-f0-9]{64}$/.test(value.imageSha256) || value.promptSha256 !== await digest(buildVideoPrompt(member.prompt))) throw new Error('Ungültiger Prüfauftrag.');
        const entries = await this.entries(), previous = entries.find(e => e.accountId === value.accountId || e.subject === value.subject || e.jobId === value.jobId);
        if (previous) {
            if (Object.keys(value).some(k => previous[k as keyof ValidationAdmission] !== value[k as keyof typeof value])) throw new Error('Dieser Prüfplatz ist bereits vergeben.');
            return;
        }
        if (entries.length >= 2) throw new Error('Die zwei genehmigten Prüfplätze sind vergeben.');
        await this.storage.put(this.key(), [...entries, { ...value, claimed: false }]);
    }
    async context(jobId: string) {
        const entry = (await this.entries()).find(e => e.jobId === jobId);
        if (!entry || this.campaign.expiresAt <= Date.now()) throw new Error('Kein freigegebener Prüfauftrag.');
        return entry;
    }
    async claim(permit: { id: string; subject: string; imageSha256: string; promptSha256: string; seed: number }) {
        const entry = await this.context(permit.id);
        if (entry.claimed || permit.subject !== entry.subject || permit.imageSha256 !== entry.imageSha256
            || permit.promptSha256 !== entry.promptSha256 || permit.seed !== entry.seed) throw new Error('Prüfauftrag bereits verbraucht oder verändert.');
        const entries = await this.entries();
        await this.storage.put(this.key(), entries.map(e => e.jobId === entry.jobId ? { ...e, claimed: true } : e));
    }
}
