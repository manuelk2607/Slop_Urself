import { fetchGpuQuota, GpuQuotaError } from '../ai/quota';
import type { Account, AuthConfig } from './session';

export interface HfConfig extends AuthConfig {
    HF_OAUTH_CLIENT_ID?: string;
    HF_OAUTH_ORIGIN?: string;
    HF_OAUTH_ENCRYPTION_KEY?: string;
}
export interface HfStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<unknown>;
}
export interface HfCredential { token: string; subject: string; username: string; expiresAt: number; accountId: string }
export class HfOAuthError extends Error {
    constructor(readonly code: 'state_invalid' | 'exchange_failed' | 'token_invalid' | 'identity_failed' | 'identity_invalid' | 'validation_failed' | 'quota_forbidden' | 'quota_unavailable', message: string) { super(message); }
}
interface Pending { account: Account; verifier: string; nonce: string; origin: string; expiresAt: number }
interface Sealed { iv: string; data: string; expiresAt: number }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const secretId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const HF_COOKIE = 'slop_hf';
export const HF_STATE_COOKIE = 'slop_hf_oauth';
export function hfCookie(request: Request, name = HF_COOKIE) {
    const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    return secretId(value) ? value : undefined;
}
export function hfOrigin(requestOrigin: string, config: HfConfig) {
    const url = new URL(config.HF_OAUTH_ORIGIN || requestOrigin);
    if (url.origin !== requestOrigin || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Ungültige HF-Spieladresse.');
    return url.origin;
}
export function hfClient(origin: string, config: HfConfig) {
    if (!config.HF_OAUTH_CLIENT_ID && new URL(origin).protocol !== 'https:') throw new Error('Für lokale HF-Anmeldung fehlt HF_OAUTH_CLIENT_ID.');
    return config.HF_OAUTH_CLIENT_ID || `${origin}/.well-known/oauth-cimd`;
}
export function hfClientMetadata(origin: string) {
    return { client_id: `${origin}/.well-known/oauth-cimd`, client_name: 'Slop Urself',
        redirect_uris: [`${origin}/api/hf/callback`], token_endpoint_auth_method: 'none', client_uri: origin };
}

// Only this server-side vault handles reusable access tokens; browser cookies hold random capabilities.
export class HfConnections {
    constructor(private storage: HfStorage, private config: HfConfig) {}
    private async key() {
        const secret = this.config.HF_OAUTH_ENCRYPTION_KEY || this.config.AUTH_COOKIE_SECRET;
        if (!secret || secret.length < 32) throw new Error('HF-Verbindung ist noch nicht eingerichtet.');
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('slopurself-hf-v1'), info: new TextEncoder().encode('oauth-vault') }, material,
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    private async save(id: string, value: Pending | HfCredential) {
        await this.cleanup();
        const expiries = await this.storage.get<Record<string, number>>('hf-expiries') || {};
        if (!expiries[id] && Object.keys(expiries).length >= 512) throw new Error('Zu viele HF-Verbindungen. Bitte später erneut versuchen.');
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, await this.key(), bytes);
        await this.storage.put(id, { iv: encode(iv), data: encode(new Uint8Array(data)), expiresAt: value.expiresAt });
        expiries[id] = value.expiresAt;
        await this.storage.put('hf-expiries', expiries);
    }
    async cleanup() {
        const expiries = await this.storage.get<Record<string, number>>('hf-expiries');
        if (!expiries) return;
        let changed = false;
        for (const [id, expiresAt] of Object.entries(expiries)) if (expiresAt <= Date.now()) { await this.storage.delete(id); delete expiries[id]; changed = true; }
        if (changed) await this.storage.put('hf-expiries', expiries);
        return Object.keys(expiries).length ? Math.min(...Object.values(expiries)) : undefined;
    }
    private async load<T extends { expiresAt: number }>(id: string): Promise<T | undefined> {
        const sealed = await this.storage.get<Sealed>(id);
        if (!sealed) return;
        if (sealed.expiresAt <= Date.now()) { await this.storage.delete(id); return; }
        try {
            const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(sealed.iv), additionalData: new TextEncoder().encode(id) }, await this.key(), decode(sealed.data));
            const value = JSON.parse(new TextDecoder().decode(bytes)) as T;
            if (value.expiresAt > Date.now()) return value;
        } catch { throw new Error('HF-Verbindung muss erneut hergestellt werden.'); }
    }
    async start(account: Account, requestOrigin: string) {
        const origin = hfOrigin(requestOrigin, this.config), client = hfClient(origin, this.config);
        const state = random(), verifier = random(), nonce = random();
        const pending: Pending = { account: { id: account.id, name: account.name, expiresAt: account.expiresAt }, verifier, nonce, origin, expiresAt: Date.now() + 10 * 60_000 };
        await this.save(`hf-pending:${state}`, pending);
        const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        const url = new URL('https://huggingface.co/oauth/authorize');
        url.search = new URLSearchParams({ client_id: client, redirect_uri: `${origin}/api/hf/callback`, response_type: 'code',
            scope: 'openid profile read-billing', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
        return { url: url.href, nonce };
    }
    async finish(state: unknown, code: unknown, nonce: unknown, requestOrigin: string) {
        if (!secretId(state) || !secretId(nonce) || typeof code !== 'string' || !code || code.length > 2048) throw new Error('Ungültige HF-Anmeldeantwort.');
        const id = `hf-pending:${state}`, pending = await this.load<Pending>(id);
        if (!pending || pending.nonce !== nonce || pending.origin !== hfOrigin(requestOrigin, this.config)) throw new HfOAuthError('state_invalid', 'HF-Anmeldung ist abgelaufen oder gehört zu einem anderen Browser.');
        await this.storage.delete(id);
        if (pending.account.expiresAt <= Date.now() || (this.config.validateAccount && !await this.config.validateAccount(pending.account))) throw new Error('Bitte melde dich zuerst erneut im Spiel an.');
        const response = await fetch('https://huggingface.co/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', client_id: hfClient(pending.origin, this.config), code,
                code_verifier: pending.verifier, redirect_uri: `${pending.origin}/api/hf/callback` }), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new HfOAuthError('exchange_failed', 'Hugging Face konnte die Anmeldung nicht abschließen. Bitte erneut verbinden.');
        const result = await response.json() as { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
        if (typeof result.access_token !== 'string' || result.access_token.length > 8192 || !result.access_token
            || !Number.isFinite(result.expires_in) || Number(result.expires_in) <= 0 || String(result.token_type).toLowerCase() !== 'bearer') throw new HfOAuthError('token_invalid', 'Ungültige HF-Zugangsdaten erhalten.');
        const identity = await fetch('https://huggingface.co/oauth/userinfo', { headers: { Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(10_000) });
        if (!identity.ok) throw new HfOAuthError('identity_failed', 'Dein HF-Konto konnte nicht verifiziert werden.');
        const user = await identity.json() as { sub?: unknown; preferred_username?: unknown };
        if (typeof user.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.sub)
            || typeof user.preferred_username !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(user.preferred_username)) throw new HfOAuthError('identity_invalid', 'Ungültiges HF-Profil.');
        const whoResponse = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(10_000) });
        if (!whoResponse.ok) throw new HfOAuthError('validation_failed', 'HF-Zugang kann nicht für die Videoerstellung verifiziert werden.');
        const who = await whoResponse.json() as { id?: unknown; name?: unknown };
        if (typeof who.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(who.id) || who.name !== user.preferred_username) throw new HfOAuthError('identity_invalid', 'Widersprüchliche HF-Identität.');
        // A successful sign-in alone does not prove this token can read ZeroGPU quota.
        try { await fetchGpuQuota({ HF_TOKEN: result.access_token }); }
        catch (error) { throw new HfOAuthError(error instanceof GpuQuotaError && error.status === 403 ? 'quota_forbidden' : 'quota_unavailable', 'HF-Anmeldung erfolgreich, aber das ZeroGPU-Kontingent konnte nicht gelesen werden. Die Verbindung wurde nicht gespeichert.'); }
        const connection = random();
        const expiresAt = Date.now() + Math.min(Number(result.expires_in), 8 * 60 * 60) * 1000;
        await this.save(`hf-connection:${connection}`, { token: result.access_token, subject: who.id, username: user.preferred_username, expiresAt, accountId: pending.account.id });
        return { connection, expiresAt };
    }
    async credential(connection: string | undefined, accountId: string | undefined) {
        if (!secretId(connection) || !accountId) throw new Error('Bitte verbinde dein Hugging-Face-Konto erneut.');
        const value = await this.load<HfCredential>(`hf-connection:${connection}`);
        if (!value || value.accountId !== accountId) throw new Error('Bitte verbinde dein Hugging-Face-Konto erneut.');
        return value;
    }
    async status(connection: string | undefined, accountId: string) {
        if (!connection) return { connected: false };
        try {
            const { username, expiresAt, token } = await this.credential(connection, accountId);
            const quota = await fetchGpuQuota({ HF_TOKEN: token });
            return { connected: true, username, expiresAt, remainingSeconds: Math.floor(quota.current), totalSeconds: quota.base };
        } catch { return { connected: false, error: 'HF-Verbindung ist abgelaufen oder gerade nicht erreichbar. Bitte erneut verbinden.' }; }
    }
    async disconnect(connection: string | undefined, accountId: string) {
        if (!connection) return;
        try { await this.credential(connection, accountId); } catch { return; }
        await this.storage.delete(`hf-connection:${connection}`);
    }
    async pinJob(connection: string, accountId: string, jobId: string) {
        await this.save(`hf-job:${jobId}`, await this.credential(connection, accountId));
    }
    async jobCredential(jobId: string) {
        const credential = await this.load<HfCredential>(`hf-job:${jobId}`);
        if (!credential) throw new Error('Der HF-Zugang des KI-Auftrags ist abgelaufen.');
        return credential;
    }
    async forgetJob(jobId: string) { await this.storage.delete(`hf-job:${jobId}`); }
}
