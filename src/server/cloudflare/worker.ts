import { authDisabled, requestAccount, sessionResponse } from '../../auth/session';
import { getDatabase } from '../../database/neon';
import { emptyStats } from '../../database/types';
import { playerCount } from '../../ai/quota';
import { DEFAULT_PROVIDER_CHAIN } from '../../ai/generation';
import { serveVideo, archiveEnabled } from '../../storage/archive';
import { httpRateRule, rateKey, RATE_MESSAGE } from '../../security/rate-limit';
import { sanitizeRoomId } from '../../game/rules';
import { service, json } from './runtime';
import type { Env } from './types';
export { RoomDurableObject } from './room';
export { ServiceDurableObject } from './services';
export type { Env } from './types';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const rule = httpRateRule(url.pathname, request.method);
        if (rule) {
            try {
                const key = await rateKey(request.headers.get('CF-Connecting-IP') || 'local', url.pathname.startsWith('/ws/') ? '/ws/' : url.pathname, env.AUTH_COOKIE_SECRET);
                const { retryAfter } = await service(env, '/security/rate', { key, rule });
                if (retryAfter) return json({ error: RATE_MESSAGE }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
            } catch { return json({ error: 'Das Spiel ist gerade nicht erreichbar.' }, { status: 503 }); }
        }

        if (url.pathname.startsWith('/api/auth/')) return new Response(null, { status: 404 });
        if (url.pathname === '/api/session') return sessionResponse(request, env, {
            create: async name => (await service(env, '/profiles/create', { name })).profile || undefined,
            find: async name => (await service(env, '/profiles/find', { name })).profile || undefined
        });

        if (url.pathname === '/api/config') {
            let players: number;
            try { players = playerCount(url.searchParams.get('players') ?? 1); } catch { return json({ error: 'Ungueltige Spielerzahl.' }, { status: 400 }); }
            const signedIn = authDisabled(env) || Boolean(await requestAccount(request, env).catch(() => undefined));
            return json({
                ...(signedIn ? await service(env, '/quota/display', { players }) : { aiRoundLimit: 0, quotaMode: 'unavailable' }),
                authEnabled: !authDisabled(env),
                aiProvider: env.AI_PROVIDER === 'mock' ? 'mock' : env.AI_PROVIDER_CHAIN || env.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN,
                mockAi: env.AI_PROVIDER === 'mock',
                videoDuration: Math.max(5, Number(env.LTX_DURATION) || 5)
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        if (url.pathname === '/api/stats') {
            try { await requestAccount(request, env); } catch { return json({ error: 'Bitte melde dich an.' }, { status: 401 }); }
            try {
                const stats = await getDatabase(env.DATABASE_URL)?.getStats() ?? emptyStats();
                return json({
                    databaseEnabled: Boolean(env.DATABASE_URL),
                    ...stats,
                    videoStorageMode: archiveEnabled(env) ? 'archive' : 'url',
                    archive: await service(env, '/archive/status').catch(() => null)
                });
            } catch (error) {
                console.error('[DB] Statistics unavailable', error instanceof Error ? error.message : 'Database error');
                return json({ error: 'Statistiken konnten nicht geladen werden.' }, { status: 503 });
            }
        }

        if (url.pathname.startsWith('/api/videos/')) {
            try { await requestAccount(request, env); } catch { return new Response(null, { status: 401 }); }
            return serveVideo(request, url.pathname.slice('/api/videos/'.length), env);
        }

        if (url.pathname === '/socket.io/socket.io.js') {
            return new Response('// Cloudflare uses native WebSockets.', { headers: { 'content-type': 'application/javascript' } });
        }

        if (url.pathname.startsWith('/ws/')) {
            if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return new Response('Invalid origin', { status: 403 });
            const roomCode = sanitizeRoomId(url.pathname.replace('/ws/', ''));
            if (!roomCode) return new Response('Missing room code', { status: 400 });
            try { await requestAccount(request, env); } catch { return new Response('Bitte melde dich an.', { status: 401 }); }

            const id = env.ROOMS.idFromName(roomCode);
            const room = env.ROOMS.get(id);
            return room.fetch(request);
        }

        return env.ASSETS.fetch(request);
    }
};
