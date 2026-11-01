import { ProviderTrustError } from './provider-trust';
import type { ProviderConfig } from './providers';
export const OFFICIAL_WAN_MODEL = { id: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers', revision: 'b8fff7315c768468a5333511427288870b2e9635' } as const;
export function requireOfficialRecipe(config: ProviderConfig & { WAN_PRODUCER_SECRET?: string }) {
    if (config.WAN_MODEL_ID !== OFFICIAL_WAN_MODEL.id || config.WAN_MODEL_REVISION !== OFFICIAL_WAN_MODEL.revision
        || !config.WAN_PRODUCER_SECRET || config.WAN_PRODUCER_SECRET.length < 32 || config.WAN_PRODUCER_SECRET.length > 4096) throw new ProviderTrustError();
}
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
export async function officialPermit(secret: string, subject: string, image: Uint8Array, prompt: string, seed: number, now = Date.now()) {
    if (secret.length < 32 || secret.length > 4096 || !/^[A-Za-z0-9_-]{1,128}$/.test(subject) || !Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) throw new ProviderTrustError();
    const encoder = new TextEncoder();
    const body = { id: crypto.randomUUID(), modelId: OFFICIAL_WAN_MODEL.id, modelRevision: OFFICIAL_WAN_MODEL.revision, subject,
        imageSha256: hex(await crypto.subtle.digest('SHA-256', image as Uint8Array<ArrayBuffer>)),
        promptSha256: hex(await crypto.subtle.digest('SHA-256', encoder.encode(prompt))), seed, steps: 50, expiresAt: Math.floor(now / 1000) + 120 };
    const bytes = encoder.encode(JSON.stringify(body));
    const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return `${payload}.${hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))}`;
}
