import { OFFICIAL_WAN_MODEL } from '../ai/official-producer';
import { generationSafetyReady, type ModerationConfig } from './moderation';
import { boundedJson } from '../server/body';
interface ClaimsStorage { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> }
interface Permit { id: string; expiresAt: number }
export async function verifyProducerPermit(token: unknown, secret: string | undefined, now = Date.now()): Promise<Permit> {
    if (typeof token !== 'string' || token.length > 4096 || !secret || secret.length < 32) throw new Error('Invalid producer permit');
    const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token); if (!match) throw new Error('Invalid producer permit');
    const encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signature = Uint8Array.from(match[2].match(/../g)!, byte => parseInt(byte, 16));
    if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(match[1]))) throw new Error('Invalid producer signature');
    const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))));
    if (!body || !/^[a-f0-9-]{36}$/.test(body.id) || body.modelId !== OFFICIAL_WAN_MODEL.id || body.modelRevision !== OFFICIAL_WAN_MODEL.revision
        || !/^[A-Za-z0-9_-]{1,128}$/.test(body.subject) || !/^[a-f0-9]{64}$/.test(body.imageSha256) || !/^[a-f0-9]{64}$/.test(body.promptSha256)
        || !Number.isInteger(body.seed) || body.seed < 0 || body.seed >= 2 ** 31 || body.steps !== 50
        || !Number.isInteger(body.expiresAt) || body.expiresAt * 1000 <= now || body.expiresAt * 1000 > now + 300_000) throw new Error('Invalid producer scope');
    return { id: body.id, expiresAt: body.expiresAt };
}
// Caller serializes mutations. Cloudflare uses the persistent Services DO;
// Node uses its durable local store. No input, credentials or raw permit saved.
export class ProducerClaims {
    constructor(private storage: ClaimsStorage, private secret: string | undefined) {}
    async claim(token: unknown, now = Date.now()) {
        const permit = await verifyProducerPermit(token, this.secret, now);
        const existing = await this.storage.get<Record<string, number>>('producer-claims:v1') || {};
        const active = Object.fromEntries(Object.entries(existing).filter(([, until]) => until * 1000 > now));
        if (Object.hasOwn(active, permit.id) || Object.keys(active).length >= 2048) throw new Error('Producer permit already used or capacity exhausted');
        active[permit.id] = permit.expiresAt;
        await this.storage.put('producer-claims:v1', active);
    }
}
export async function producerClaimResponse(request: Request, config: ModerationConfig & { WAN_PRODUCER_SECRET?: string }, claim: (permit: string) => Promise<void>) {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (request.method !== 'POST') return new Response('{}', { status: 405, headers });
    try {
        if (config.AI_PROVIDER === 'mock') throw new Error('No producer in mock mode');
        generationSafetyReady(config);
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Error('Invalid content type');
        const body = await boundedJson(request, 8192) as { permit?: unknown };
        await verifyProducerPermit(body?.permit, config.WAN_PRODUCER_SECRET);
        await claim(body.permit as string);
        return new Response('{"claimed":true}', { status: 201, headers });
    } catch { return new Response('{"error":"producer_claim_rejected"}', { status: 503, headers }); }
}
