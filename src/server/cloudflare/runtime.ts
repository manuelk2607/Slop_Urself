import type { Env } from './types';
import { roundLimit } from '../../game/rules';
import { HistoryError } from '../statistics';
import { HfRequiredError, HfOAuthError, isHfOAuthCode, hfOAuthMessage } from '../../auth/huggingface';
import { ModerationError } from '../../security/moderation';

export async function service(env: Env, path: string, payload?: unknown) {
    if (!env.SERVICES && env.AI_PROVIDER === 'mock') return { aiRoundLimit: getAiRoundLimit(env), playerCount: (payload as { players?: number })?.players || 1, quotaMode: 'mock' };
    if (!env.SERVICES) throw new Error('Cloudflare SERVICES-Binding fehlt.');
    const key = (payload as { key?: unknown })?.key;
    // A noisy client must not fill or serialize the limiter registry for every other client.
    const name = path === '/security/rate' && typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? `rate:${key}` : 'global';
    const response = await env.SERVICES.get(env.SERVICES.idFromName(name)).fetch(new Request(`https://internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) }));
    const result = await response.json() as Record<string, any>;
    if (!response.ok) {
        if (result.code === 'hf_required') throw new HfRequiredError();
        if (isHfOAuthCode(result.code)) throw new HfOAuthError(result.code, hfOAuthMessage(result.code));
        if (['moderation_unavailable', 'content_blocked', 'content_review'].includes(result.code)) throw new ModerationError(result.code, result.error);
        throw new HistoryError(result.error || 'KI- oder Videospeicher nicht erreichbar.', response.status);
    }
    return result;
}

export function json(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(body), {
        ...init,
        headers
    });
}

export function getAiRoundLimit(env: Env) { return roundLimit(env.AI_ROUND_LIMIT); }
