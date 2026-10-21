import { jwtVerify, SignJWT } from 'jose';
import { profileName, type ProfileStore } from './profiles';
import { hfCookie, HF_COOKIE, HF_STATE_COOKIE } from './huggingface';
import { checkPassword, hashPassword, validPassword } from './passwords';

export interface AuthConfig {
    AUTH_MODE?: string; AI_PROVIDER?: string; AUTH_COOKIE_SECRET?: string;
    ADMIN_ACCOUNT_ID?: string; ADMIN_ACCESS_KEY?: string;
    validateAccount?: (account: Account) => Promise<boolean>;
}
export interface Account { id: string; name: string; expiresAt: number; authVersion?: string; hfConnectionId?: string }
class ProfileUnavailableError extends Error {}
export const authFailureStatus = (error: unknown) => error instanceof ProfileUnavailableError ? 503 : 401;
export const authDisabled = (config: AuthConfig) => config.AUTH_MODE === 'disabled' && config.AI_PROVIDER === 'mock';
export function profileAuthConfig<T extends AuthConfig>(config: T, profiles: ProfileStore): T {
    return { ...config, validateAccount: async account => {
        try { const profile = await profiles.find(account.name); return profile?.id === account.id && (profile.authVersion || '0') === (account.authVersion || '0'); }
        catch { throw new ProfileUnavailableError('Deine Browsersitzung ist gerade nicht erreichbar. Bitte versuche es erneut.'); }
    } };
}
export async function accountIsCurrent(account: Account, config: AuthConfig) {
    return !config.validateAccount || await config.validateAccount(account);
}
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const signingKey = (config: AuthConfig) => {
    if (!config.AUTH_COOKIE_SECRET || config.AUTH_COOKIE_SECRET.length < 32) throw new Error('Die Browsersitzung ist noch nicht eingerichtet.');
    return new TextEncoder().encode(config.AUTH_COOKIE_SECRET);
};

export async function verifyAccountToken(token: unknown, config: AuthConfig): Promise<Account> {
    if (typeof token !== 'string' || token.length > 4000) throw new Error('Bitte gib deinen Benutzernamen ein.');
    const { payload } = await jwtVerify(token, signingKey(config), { issuer: 'slopurself', audience: 'game', algorithms: ['HS256'] });
    if (!payload.sub || !payload.exp || payload.role !== 'player') throw new Error('Ungültige Browsersitzung.');
    const account = { id: payload.sub, name: profileName(payload.name), expiresAt: payload.exp * 1000, authVersion: typeof payload.av === 'string' ? payload.av : '0' };
    if (!await accountIsCurrent(account, config)) throw new Error('Dieses Benutzerkonto wurde gelöscht.');
    return account;
}

export async function requestAccount(request: Request, config: AuthConfig) {
    if (authDisabled(config)) return undefined;
    const token = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('slop_auth='))?.slice(10);
    return { ...await verifyAccountToken(token, config), hfConnectionId: hfCookie(request) };
}

export async function sessionResponse(request: Request, config: AuthConfig, profiles: ProfileStore) {
    config = profileAuthConfig(config, profiles);
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'GET') {
        try {
            const account = await requestAccount(request, config);
            return respond({ account: account && { id: account.id, name: account.name, expiresAt: account.expiresAt } });
        }
        catch (error) { return respond({ error: authFailureStatus(error) === 503 ? (error as Error).message : 'Bitte gib deinen Benutzernamen ein.' }, authFailureStatus(error)); }
    }
    if (request.method !== 'POST' && request.method !== 'DELETE') return respond({}, 405);
    if (request.headers.get('origin') !== new URL(request.url).origin) return respond({}, 403);
    const secure = request.url.startsWith('https:') ? '; Secure' : '';
    if (request.method === 'DELETE') {
        headers.set('set-cookie', `slop_auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
        headers.append('set-cookie', `slop_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${secure}`);
        for (const name of [HF_COOKIE, HF_STATE_COOKIE]) headers.append('set-cookie', `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
        return respond({});
    }
    try { signingKey(config); } catch { return respond({ error: 'Die Browsersitzung ist noch nicht eingerichtet.' }, 503); }
    let data: { username?: unknown; mode?: unknown; password?: unknown };
    try {
        const body = await request.text();
        if (body.length > 2000) return respond({}, 413);
        data = JSON.parse(body);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    } catch { return respond({ error: 'Ungültige Anfrage.' }, 400); }
    let profile;
    if (data.mode === 'refresh') {
        try { profile = await requestAccount(request, config); }
        catch (error) { if (authFailureStatus(error) === 503) return respond({ error: (error as Error).message }, 503); }
        if (!profile) return respond({ error: 'Bitte gib deinen Benutzernamen erneut ein.' }, 401);
    } else {
        let name: string;
        try { name = profileName(data.username); } catch (error) { return respond({ error: (error as Error).message }, 422); }
        if (data.mode !== 'create' && data.mode !== 'login') return respond({ error: 'Ungültige Anfrage.' }, 400);
        if (data.mode === 'create' && data.password !== undefined && data.password !== '' && !validPassword(data.password)) return respond({ error: 'Das Passwort muss 12 bis 200 Zeichen lang sein.' }, 422);
        try { profile = await (data.mode === 'create' ? profiles.create(name, data.password ? await hashPassword(data.password as string) : undefined) : profiles.find(name)); }
        catch { return respond({ error: `${data.mode === 'create' ? 'Die Registrierung' : 'Die Anmeldung'} ist gerade nicht erreichbar. Bitte versuche es erneut.` }, 503); }
        if (!profile) return respond({ error: data.mode === 'create'
            ? 'Dieser Benutzername ist bereits vergeben. Melde dich mit dem vorhandenen Benutzer an oder verwende einen anderen Namen.'
            : 'Dieser Benutzername existiert noch nicht. Erstelle ihn mit "Neuen Benutzer registrieren".' }, data.mode === 'create' ? 409 : 404);
        if (data.mode === 'login' && profile.passwordHash) {
            if (!data.password) return respond({ error: 'Dieses Profil ist geschützt. Bitte gib dein Passwort ein.', code: 'password_required' }, 401);
            if (!await checkPassword(data.password, profile.passwordHash)) return respond({ error: 'Das Passwort stimmt nicht.', code: 'password_required' }, 401);
        }
    }
    const token = await new SignJWT({ name: profile.name, role: 'player', av: profile.authVersion || '0' }).setSubject(profile.id).setProtectedHeader({ alg: 'HS256' }).setIssuer('slopurself').setAudience('game').setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).sign(signingKey(config));
    const account = await verifyAccountToken(token, { ...config, validateAccount: undefined });
    headers.set('set-cookie', `slop_auth=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`);
    return respond({ account, token });
}
