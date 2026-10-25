import { authDisabled, requestAccount, sessionResponse, authFailureStatus } from '../../auth/session';
import { getDatabase } from '../../database/neon';
import { emptyStats } from '../../database/types';
import { playerCount } from '../../ai/quota';
import { DEFAULT_PROVIDER_CHAIN } from '../../ai/generation';
import { serveVideo, archiveEnabled, archiveRoomHint } from '../../storage/archive';
import { httpRateRule, httpRateScope, rateKey, RATE_MESSAGE } from '../../security/rate-limit';
import { sanitizeRoomId } from '../../game/rules';
import { service, json } from './runtime';
import { historyResponse, historyListing, restoreHistoryResponse, HistoryError, historyViewer, authorizeHistory, authorizeRestore } from '../statistics';
import { accountsResponse } from '../accounts';
import { cloudflareAuth, serviceProfiles } from './profiles';
import { huggingFaceResponse } from '../huggingface';
import { indexingResponse } from '../indexing';
import { publicSeoResponse } from '../seo';
import type { Env } from './types';
export { RoomDurableObject } from './room';
export { ServiceDurableObject } from './services';
export type { Env } from './types';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        return indexingResponse(request, await handleRequest(request, env));
    }
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const seoResponse = publicSeoResponse(url.pathname, request.method);
        if (seoResponse) return seoResponse;
        const auth = cloudflareAuth(env);
        const rule = httpRateRule(url.pathname, request.method);
        if (rule) {
            try {
                const key = await rateKey(request.headers.get('CF-Connecting-IP') || 'local', httpRateScope(url.pathname, request.method), env.AUTH_COOKIE_SECRET);
                const { retryAfter } = await service(env, '/security/rate', { key, rule });
                if (retryAfter) return json({ error: RATE_MESSAGE }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
            } catch { return json({ error: 'Das Spiel ist gerade nicht erreichbar.' }, { status: 503 }); }
        }

        if (url.pathname === '/.well-known/oauth-cimd' || url.pathname === '/api/hf' || url.pathname.startsWith('/api/hf/')) return huggingFaceResponse(request, auth, (path, data) => service(env, path, data));
        if (url.pathname.startsWith('/api/auth/')) return new Response(null, { status: 404 });
        if (url.pathname === '/api/session') return sessionResponse(request, auth, serviceProfiles(env));
        if (url.pathname.startsWith('/api/admin/')) return accountsResponse(request, auth, serviceProfiles(env));
        const imageRoom = /^\/api\/rooms\/([A-Z0-9]{4})\/image$/.exec(url.pathname);
        if (imageRoom) return env.ROOMS.get(env.ROOMS.idFromName(imageRoom[1])).fetch(request);

        if (url.pathname === '/api/config') {
            let players: number;
            try { players = playerCount(url.searchParams.get('players') ?? 1); } catch { return json({ error: 'Ungültige Spielerzahl.' }, { status: 400 }); }
            const account = await requestAccount(request, auth).catch(() => undefined);
            const signedIn = authDisabled(env) || Boolean(account);
            return json({
                ...(signedIn ? await service(env, '/quota/display', { players, participants: account?.hfConnectionId && players === 1 ? [{ id: account.id, accountId: account.id, hfConnectionId: account.hfConnectionId }] : undefined }) : { aiRoundLimit: 0, quotaMode: 'unavailable' }),
                authEnabled: !authDisabled(env),
                aiProvider: env.AI_PROVIDER === 'mock' ? 'mock' : env.AI_PROVIDER_CHAIN || env.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN,
                mockAi: env.AI_PROVIDER === 'mock',
                hfRequired: env.AI_PROVIDER !== 'mock',
                videoDuration: Math.max(5, Number(env.LTX_DURATION) || 5)
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        if (url.pathname === '/api/stats') {
            let account;
            try { account = await requestAccount(request, auth); } catch (error) { return json({ error: authFailureStatus(error) === 503 ? 'Deine Browsersitzung ist gerade nicht erreichbar.' : 'Bitte melde dich an.' }, { status: authFailureStatus(error) }); }
            try {
                const archive = await service(env, '/archive/status').catch(() => null);
                const stats = await getDatabase(env.DATABASE_URL)?.getStats(url.searchParams.get('player')?.slice(0, 100), historyViewer(account, auth)) ?? emptyStats();
                return json({
                    databaseEnabled: Boolean(env.DATABASE_URL),
                    ...stats,
                    videoStorageMode: archiveEnabled(env) ? 'archive' : 'url',
                    archive
                });
            } catch (error) {
                console.error('[DB] Statistics unavailable', error instanceof Error ? error.message : 'Database error');
                return json({ error: 'Statistiken konnten nicht geladen werden.' }, { status: 503 });
            }
        }

        if (url.pathname === '/api/stats/videos' || url.pathname === '/api/stats/rooms') return historyListing(request, auth, getDatabase(env.DATABASE_URL));

        if (url.pathname === '/api/stats/videos/restore') return restoreHistoryResponse(request, auth, async ids => (await service(env, '/video-trash/restore', { ids })).results,
            (ids, account) => authorizeRestore(getDatabase(env.DATABASE_URL), ids, account, auth));

        if (url.pathname.startsWith('/api/stats/rooms/') || url.pathname.startsWith('/api/stats/videos/')) return historyResponse(request, auth, async command => {
            const room = env.ROOMS.get(env.ROOMS.idFromName(command.code));
            const response = await room.fetch(new Request('https://internal/statistics/delete', { method: 'POST', body: JSON.stringify(command) }));
            if (!response.ok) throw new HistoryError((await response.json() as { error: string }).error, response.status);
            return await response.json();
        }, async id => {
            const database = getDatabase(env.DATABASE_URL);
            if (!database) throw new HistoryError('Die Statistik-Datenbank ist nicht eingerichtet.');
            return database.savedVideo(id);
        }, (command, account) => authorizeHistory(getDatabase(env.DATABASE_URL), command, account, auth));

        if (url.pathname.startsWith('/api/videos/')) {
            let account;
            try { account = await requestAccount(request, auth); } catch (error) { return new Response(null, { status: authFailureStatus(error) }); }
            if (!authDisabled(env) && account?.id !== env.ADMIN_ACCOUNT_ID) {
                const code = archiveRoomHint(url.pathname);
                const live = code && account && (await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request('https://internal/video/access', {
                    method: 'POST', body: JSON.stringify({ accountId: account.id, url: url.pathname }) }))).ok;
                if (!live && (!account || !await getDatabase(env.DATABASE_URL)?.canReadVideo(url.pathname, account.id))) return new Response(null, { status: 403 });
            }
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
