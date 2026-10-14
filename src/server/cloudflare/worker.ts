import { authDisabled, requestAccount, sessionResponse, authFailureStatus } from '../../auth/session';
import { getDatabase } from '../../database/neon';
import { emptyStats } from '../../database/types';
import { playerCount } from '../../ai/quota';
import { DEFAULT_PROVIDER_CHAIN } from '../../ai/generation';
import { serveVideo, archiveEnabled } from '../../storage/archive';
import { httpRateRule, rateKey, RATE_MESSAGE } from '../../security/rate-limit';
import { sanitizeRoomId } from '../../game/rules';
import { service, json } from './runtime';
import { historyResponse, HistoryError } from '../statistics';
import { accountsResponse } from '../accounts';
import { cloudflareAuth, serviceProfiles } from './profiles';
import type { Env } from './types';
export { RoomDurableObject } from './room';
export { ServiceDurableObject } from './services';
export type { Env } from './types';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const auth = cloudflareAuth(env);
        const rule = httpRateRule(url.pathname, request.method);
        if (rule) {
            try {
                const key = await rateKey(request.headers.get('CF-Connecting-IP') || 'local', url.pathname.startsWith('/ws/') ? '/ws/' : url.pathname, env.AUTH_COOKIE_SECRET);
                const { retryAfter } = await service(env, '/security/rate', { key, rule });
                if (retryAfter) return json({ error: RATE_MESSAGE }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
            } catch { return json({ error: 'Das Spiel ist gerade nicht erreichbar.' }, { status: 503 }); }
        }

        if (url.pathname.startsWith('/api/auth/')) return new Response(null, { status: 404 });
        if (url.pathname === '/api/session') return sessionResponse(request, auth, serviceProfiles(env));
        if (url.pathname.startsWith('/api/admin/')) return accountsResponse(request, auth, serviceProfiles(env));

        if (url.pathname === '/api/config') {
            let players: number;
            try { players = playerCount(url.searchParams.get('players') ?? 1); } catch { return json({ error: 'Ungültige Spielerzahl.' }, { status: 400 }); }
            const signedIn = authDisabled(env) || Boolean(await requestAccount(request, auth).catch(() => undefined));
            return json({
                ...(signedIn ? await service(env, '/quota/display', { players }) : { aiRoundLimit: 0, quotaMode: 'unavailable' }),
                authEnabled: !authDisabled(env),
                aiProvider: env.AI_PROVIDER === 'mock' ? 'mock' : env.AI_PROVIDER_CHAIN || env.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN,
                mockAi: env.AI_PROVIDER === 'mock',
                videoDuration: Math.max(5, Number(env.LTX_DURATION) || 5)
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        if (url.pathname === '/api/stats') {
            try { await requestAccount(request, auth); } catch (error) { return json({ error: authFailureStatus(error) === 503 ? 'Deine Browsersitzung ist gerade nicht erreichbar.' : 'Bitte melde dich an.' }, { status: authFailureStatus(error) }); }
            try {
                const stats = await getDatabase(env.DATABASE_URL)?.getStats(url.searchParams.get('player')?.slice(0, 100)) ?? emptyStats();
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

        if (url.pathname.startsWith('/api/stats/rooms/') || url.pathname.startsWith('/api/stats/videos/')) return historyResponse(request, auth, async command => {
            const room = env.ROOMS.get(env.ROOMS.idFromName(command.code));
            const response = await room.fetch(new Request('https://internal/statistics/delete', { method: 'POST', body: JSON.stringify(command) }));
            if (!response.ok) throw new HistoryError((await response.json() as { error: string }).error, response.status);
            return await response.json();
        }, async id => {
            const database = getDatabase(env.DATABASE_URL);
            if (!database) throw new HistoryError('Die Statistik-Datenbank ist nicht eingerichtet.');
            return database.savedVideo(id);
        });

        if (url.pathname.startsWith('/api/videos/')) {
            try { await requestAccount(request, auth); } catch (error) { return new Response(null, { status: authFailureStatus(error) }); }
            return serveVideo(request, url.pathname.slice('/api/videos/'.length), env);
        }

        if (url.pathname === '/socket.io/socket.io.js') {
            return new Response('// Cloudflare uses native WebSockets.', { headers: { 'content-type': 'application/javascript' } });
        }

        if (url.pathname.startsWith('/ws/')) {
            if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return new Response('Invalid origin', { status: 403 });
            const roomCode = sanitizeRoomId(url.pathname.replace('/ws/', ''));
            if (!roomCode) return new Response('Missing room code', { status: 400 });
            try { await requestAccount(request, auth); } catch (error) { return new Response('Verbindung nicht möglich. Bitte versuche es erneut.', { status: authFailureStatus(error) }); }

            const id = env.ROOMS.idFromName(roomCode);
            const room = env.ROOMS.get(id);
            return room.fetch(request);
        }

        return env.ASSETS.fetch(request);
    }
};
