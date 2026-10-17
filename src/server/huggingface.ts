import { hfCookie, hfOrigin, hfClient, hfClientMetadata, HfOAuthError, HF_COOKIE, HF_STATE_COOKIE, type HfConfig } from '../auth/huggingface';
import { requestAccount, authFailureStatus } from '../auth/session';

export type HfService = (path: string, data: Record<string, unknown>) => Promise<Record<string, any>>;
export async function huggingFaceResponse(request: Request, config: HfConfig, service: HfService): Promise<Response> {
    const url = new URL(request.url), headers = new Headers({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    const json = (value: unknown, status = 200) => { headers.set('content-type', 'application/json'); return new Response(JSON.stringify(value), { status, headers }); };
    const cookie = (name: string, value: string, seconds: number, lax = false) => headers.append('set-cookie', `${name}=${value}; HttpOnly; SameSite=${lax ? 'Lax' : 'Strict'}; Path=/; Max-Age=${seconds}${url.protocol === 'https:' ? '; Secure' : ''}`);
    if (url.pathname === '/.well-known/oauth-cimd') {
        if (request.method !== 'GET') return json({}, 405);
        try { return json(hfClientMetadata(hfOrigin(url.origin, config))); } catch { return json({}, 400); }
    }
    if (url.pathname === '/api/hf/callback') {
        if (request.method !== 'GET') return json({}, 405);
        let success = false;
        try {
            if (url.searchParams.has('error')) throw new Error('HF-Anmeldung wurde abgebrochen.');
            const result = await service('/hf/finish', { state: url.searchParams.get('state'), code: url.searchParams.get('code'), nonce: hfCookie(request, HF_STATE_COOKIE), origin: url.origin });
            cookie(HF_COOKIE, result.connection, Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1000)));
            success = true;
        } catch (error) {
            // Only application-defined error codes, never provider responses or authorization codes.
            console.info('[HF] OAuth callback failed', error instanceof HfOAuthError ? error.code : 'callback_failed');
        }
        cookie(HF_STATE_COOKIE, '', 0, true);
        headers.set('location', `/?hf=${success ? 'connected' : 'failed'}`);
        return new Response(null, { status: 303, headers });
    }
    let account;
    try { account = await requestAccount(request, config); if (!account) return json({ error: 'Bitte melde dich an.' }, 401); }
    catch (error) { return json({ error: 'Bitte melde dich erneut an.' }, authFailureStatus(error)); }
    if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return json({}, 403);
    try {
        const connection = hfCookie(request), accountId = account.id;
        if (url.pathname === '/api/hf' && request.method === 'GET') {
            let configured = true;
            try { hfClient(hfOrigin(url.origin, config), config); } catch { configured = false; }
            return json({ configured, ...await service('/hf/status', { connection, accountId }) });
        }
        if (url.pathname === '/api/hf/connect' && request.method === 'POST') {
            const result = await service('/hf/start', { account, origin: url.origin });
            cookie(HF_STATE_COOKIE, result.nonce, 600, true);
            return json({ url: result.url });
        }
        if (url.pathname === '/api/hf' && request.method === 'DELETE') {
            await service('/hf/disconnect', { connection, accountId });
            cookie(HF_COOKIE, '', 0); cookie(HF_STATE_COOKIE, '', 0, true);
            return json({ ok: true });
        }
        return json({}, 405);
    } catch { return json({ error: 'HF-Verbindung konnte nicht aktualisiert werden. Bitte versuche es erneut.' }, 503); }
}
