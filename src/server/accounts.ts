import { jwtVerify, SignJWT } from 'jose';
import { requestAccount, profileAuthConfig, authFailureStatus, type AuthConfig, type Account } from '../auth/session';
import type { ManagedProfileStore } from '../auth/profiles';
import { historyJson } from './statistics';
import { hashPassword, validPassword } from '../auth/passwords';
import { boundedJson } from './body';

const ADMIN_SECONDS = 24 * 60 * 60;
const enabled = (config: AuthConfig) => Boolean(config.ADMIN_ACCOUNT_ID && config.ADMIN_ACCESS_KEY && config.ADMIN_ACCESS_KEY.length >= 32);
const adminKey = (config: AuthConfig) => new TextEncoder().encode(config.ADMIN_ACCESS_KEY);
export async function unlocked(request: Request, config: AuthConfig, account: Account) {
    if (!enabled(config) || account.id !== config.ADMIN_ACCOUNT_ID) return false;
    const token = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith('slop_admin='))?.slice(11);
    if (!token || token.length > 4000) return false;
    try {
        const { payload } = await jwtVerify(token, adminKey(config), { issuer: 'slopurself', audience: 'administration', algorithms: ['HS256'] });
        return payload.sub === account.id && payload.sub === config.ADMIN_ACCOUNT_ID && payload.role === 'admin' && Boolean(payload.exp) && (payload.av || '0') === (account.authVersion || '0');
    } catch { return false; }
}
async function matchesKey(input: string, expected: string) {
    const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    const [a, b] = await Promise.all([digest(input), digest(expected)]);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    return difference === 0;
}

export async function accountsResponse(request: Request, config: AuthConfig, profiles: ManagedProfileStore) {
    const path = new URL(request.url).pathname;
    const listing = path === '/api/admin/accounts' && request.method === 'GET';
    const session = path === '/api/admin/session';
    const target = /^\/api\/admin\/accounts\/([^/]+)(\/password)?$/.exec(path);
    const passwordChange = Boolean(target?.[2] && request.method === 'POST');
    if (!listing && !(session && ['POST', 'DELETE'].includes(request.method)) && !(target && !target[2] && request.method === 'DELETE') && !passwordChange) return historyJson({}, 405);
    if (!listing && request.headers.get('origin') !== new URL(request.url).origin) return historyJson({ error: 'Ungültiger Ursprung.' }, 403);
    try {
        // Legacy owners may recover through the independently protected admin key.
        const account = await requestAccount(request, { ...profileAuthConfig(config, profiles), allowPendingAuth: true }).catch(error => { if (authFailureStatus(error) === 503) throw error; return undefined; });
        if (!account) return historyJson({ error: 'Bitte melde dich an.' }, 401);
        const available = enabled(config) && account.id === config.ADMIN_ACCOUNT_ID;
        if (!available) return listing ? historyJson({ available: false, unlocked: false, accounts: [] }) : historyJson({ error: 'Nur der Besitzer darf Benutzer verwalten.' }, 403);
        const secure = request.url.startsWith('https:') ? '; Secure' : '';
        const cookie = (value: string, seconds: number) => `slop_admin=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${seconds}${secure}`;
        if (session && request.method === 'DELETE') {
            const response = historyJson({ ok: true }); response.headers.set('set-cookie', cookie('', 0)); return response;
        }
        if (listing) {
            const access = await unlocked(request, config, account);
            return historyJson({ available: true, unlocked: access, accounts: access ? (await profiles.list()).map(profile => ({ id: profile.id, name: profile.name, passwordProtected: Boolean(profile.passwordHash), protected: profile.id === config.ADMIN_ACCOUNT_ID })) : [] });
        }
        let data: { key?: unknown; confirmation?: unknown; password?: unknown };
        try { data = await boundedJson(request, 2000) as typeof data; if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
        catch (error) { return historyJson({ error: error instanceof RangeError ? error.message : 'Ungültige Anfrage.' }, error instanceof RangeError ? 413 : 400); }
        if (session) {
            if (typeof data.key !== 'string' || data.key.length > 200 || !await matchesKey(data.key, config.ADMIN_ACCESS_KEY!)) return historyJson({ error: 'Der Verwaltungsschlüssel ist nicht gültig.' }, 403);
            const token = await new SignJWT({ role: 'admin', av: account.authVersion || '0' }).setSubject(account.id).setProtectedHeader({ alg: 'HS256' }).setIssuer('slopurself').setAudience('administration').setIssuedAt().setExpirationTime(`${ADMIN_SECONDS}s`).sign(adminKey(config));
            const response = historyJson({ ok: true }); response.headers.set('set-cookie', cookie(token, ADMIN_SECONDS)); return response;
        }
        if (!await unlocked(request, config, account)) return historyJson({ error: 'Bitte schalte die Benutzerverwaltung zuerst frei.' }, 403);
        const id = decodeURIComponent(target![1]);
        if (!passwordChange && id === config.ADMIN_ACCOUNT_ID) return historyJson({ error: 'Das Besitzerkonto kann nicht gelöscht werden.' }, 403);
        if (typeof data.confirmation !== 'string') return historyJson({ error: 'Die Löschbestätigung fehlt.' }, 400);
        const profile = await profiles.find(data.confirmation).catch(() => undefined);
        if (!profile || profile.id !== id || profile.name !== data.confirmation) return historyJson({ error: 'Der Benutzer wurde nicht gefunden oder die Bestätigung stimmt nicht überein.' }, 409);
        if (passwordChange) {
            if (!validPassword(data.password)) return historyJson({ error: 'Das Passwort muss 12 bis 200 Zeichen lang sein.' }, 422);
            if (!await profiles.setPassword(id, await hashPassword(data.password))) return historyJson({ error: 'Benutzer nicht gefunden.' }, 404);
            return historyJson({ ok: true });
        }
        await profiles.remove(id);
        return historyJson({ ok: true });
    } catch { return historyJson({ error: 'Die Benutzerverwaltung ist gerade nicht erreichbar.' }, 503); }
}
