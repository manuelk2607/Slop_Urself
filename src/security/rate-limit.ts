export interface RateRule { limit: number; windowMs: number }
export interface RateBucket { used: number; expiresAt: number }
export type RateBuckets = Record<string, RateBucket>;

export function takeRateLimit(buckets: RateBuckets, key: string, rule: RateRule, now = Date.now(), cost = 1) {
    for (const [id, bucket] of Object.entries(buckets)) if (bucket.expiresAt <= now) delete buckets[id];
    let bucket = buckets[key];
    // Bound local memory without turning one full registry into a global ban.
    if (!bucket && Object.keys(buckets).length >= 2048) {
        const oldest = Object.keys(buckets).reduce((a, b) => buckets[a].expiresAt <= buckets[b].expiresAt ? a : b);
        delete buckets[oldest];
    }
    bucket ??= buckets[key] = { used: 0, expiresAt: now + rule.windowMs };
    if (!Number.isSafeInteger(cost) || cost < 1 || bucket.used + cost > rule.limit) return Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
    bucket.used += cost;
    return 0;
}

export function httpRateRule(path: string, method: string): RateRule | undefined {
    if (path === '/api/moderation/reports') return { limit: 12, windowMs: 60_000 };
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
export const MESSAGE_BYTES: RateRule = { limit: 32 * 1024 * 1024, windowMs: 60_000 };
export const expensiveMessageRule = (event: string): RateRule | undefined => ['createRoom', 'sendImage', 'setSharedImage'].includes(event) ? { limit: 8, windowMs: 60_000 } : undefined;
export function payloadBytes(value: unknown) {
    let size = 0, nodes = 0;
    function count(v: unknown, depth: number) {
        if (depth > 16 || ++nodes > 2048) throw new Error('Die Nachricht ist zu komplex.');
        if (typeof v === 'string') size += new TextEncoder().encode(v).length;
        else if (v && typeof v === 'object') {
            const keys = Object.keys(v);
            if (keys.length > 2048 || (Object.getPrototypeOf(v) !== Object.prototype && !Array.isArray(v))) throw new Error('Ungültige Nachricht.');
            for (const key of keys) { size += key.length; count((v as Record<string, unknown>)[key], depth + 1); }
        } else size += 8;
        if (size > 12 * 1024 * 1024) throw new Error('Die Nachricht ist zu groß.');
    }
    count(value, 0); return Math.max(1, size);
}
export const RATE_MESSAGE = 'Zu viele Anfragen. Bitte warte einen Moment.';
