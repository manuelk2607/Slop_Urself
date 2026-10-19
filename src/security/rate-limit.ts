export interface RateRule { limit: number; windowMs: number }
export interface RateBucket { used: number; expiresAt: number }
export type RateBuckets = Record<string, RateBucket>;

export function takeRateLimit(buckets: RateBuckets, key: string, rule: RateRule, now = Date.now()) {
    for (const [id, bucket] of Object.entries(buckets)) if (bucket.expiresAt <= now) delete buckets[id];
    let bucket = buckets[key];
    // Bound local memory without turning one full registry into a global ban.
    if (!bucket && Object.keys(buckets).length >= 2048) {
        const oldest = Object.keys(buckets).reduce((a, b) => buckets[a].expiresAt <= buckets[b].expiresAt ? a : b);
        delete buckets[oldest];
    }
    bucket ??= buckets[key] = { used: 0, expiresAt: now + rule.windowMs };
    if (bucket.used >= rule.limit) return Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
    bucket.used++;
    return 0;
}

export function httpRateRule(path: string, method: string): RateRule | undefined {
    if (path === '/api/hf/connect' || path === '/api/hf/callback' || (path === '/api/hf/device' && method === 'POST')) return { limit: 12, windowMs: 60_000 };
    if (path === '/api/hf/device-poll') return { limit: 240, windowMs: 60_000 };
    if (path === '/api/hf/device') return { limit: 60, windowMs: 60_000 };
    if (path === '/api/hf') return { limit: 60, windowMs: 60_000 };
    if (path === '/api/session' && method === 'POST') return { limit: 60, windowMs: 60_000 };
    if (path === '/api/admin/session' && method === 'POST') return { limit: 5, windowMs: 60_000 };
    if (path.startsWith('/api/admin/')) return { limit: 60, windowMs: 60_000 };
    if (path === '/api/config' || path === '/api/stats' || path.startsWith('/api/stats/')) return { limit: 120, windowMs: 60_000 };
    if (path.startsWith('/ws/')) return { limit: 60, windowMs: 60_000 };
    if (path.startsWith('/api/rooms/')) return { limit: 120, windowMs: 60_000 };
}

export function httpRateScope(path: string, method: string) {
    if (path.startsWith('/ws/')) return '/ws/';
    if (path.startsWith('/api/stats/')) return '/api/stats/';
    if (path.startsWith('/api/rooms/')) return '/api/rooms/';
    if (path.startsWith('/api/admin/') && path !== '/api/admin/session') return '/api/admin/';
    // Methods with different limits must not inherit each other's allowance.
    return `${method}:${path}`;
}

export async function rateKey(identity: string, scope: string, secret = '') {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:${scope}:${identity}`));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export const MESSAGE_RATE: RateRule = { limit: 120, windowMs: 60_000 };
export const RATE_MESSAGE = 'Zu viele Anfragen. Bitte warte einen Moment.';
