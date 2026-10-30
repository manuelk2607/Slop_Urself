import { fetchGpuQuota, GpuQuotaError } from '../ai/quota';
import { boundedJson } from '../server/body';
import type { Account, AuthConfig } from './session';

export interface HfConfig extends AuthConfig {
    HF_OAUTH_CLIENT_ID?: string;
    HF_OAUTH_ORIGIN?: string;
    HF_OAUTH_ENCRYPTION_KEY?: string;
    HF_OAUTH_PREVIOUS_ENCRYPTION_KEY?: string;
}
export interface HfStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<unknown>;
}
export interface HfCredential { token: string; subject: string; username: string; expiresAt: number; accountId: string }
export class HfRequiredError extends Error {
    constructor() { super('Bitte verbinde dein persönliches Hugging-Face-Konto, um mitzuspielen.'); }
}
export async function requirePlayerHf(config: { AI_PROVIDER?: string }, account: Account | undefined, connections: HfConnections) {
    if (config.AI_PROVIDER !== 'mock') await connections.credential(account?.hfConnectionId, account?.id);
}
export class HfOAuthError extends Error {
    constructor(readonly code: 'state_invalid' | 'exchange_failed' | 'token_invalid' | 'identity_failed' | 'identity_invalid' | 'identity_unclaimed' | 'validation_failed' | 'quota_forbidden' | 'quota_unavailable', message: string) { super(message); }
}
const oauthMessages = {
    state_invalid: 'Die HF-Anmeldung ist abgelaufen. Bitte erneut verbinden.',
    exchange_failed: 'Hugging Face konnte den Anmeldecode gerade nicht austauschen. Bitte die Verbindung später erneut prüfen.',
    token_invalid: 'Der erhaltene HF-Zugang ist ungültig oder abgelaufen. Bitte erneut verbinden.',
    identity_failed: 'Das öffentliche HF-Profil ist gerade nicht erreichbar. Es wurde keine KI-Generierung freigegeben.',
    identity_invalid: 'Die HF-Identitätsangaben stimmen nicht überein. Bitte erneut anmelden.',
    identity_unclaimed: 'Dieses Spielprofil konnte diesem HF-Konto nicht sicher zugeordnet werden. Bitte den bisherigen Profilzugang verwenden.',
    validation_failed: 'Der HF-Zugang konnte beim Anbieter gerade nicht bestätigt werden. Es wurde keine KI-Generierung freigegeben.',
    quota_forbidden: 'HF verweigert den Kontingentabruf. Bitte die Freigabe read-billing und den HF-Kontostatus prüfen.',
    quota_unavailable: 'HF hat die Anmeldung bestätigt, aber das ZeroGPU-Kontingent ist gerade nicht lesbar. Der erhaltene Zugang bleibt für einen begrenzten erneuten Prüfversuch geschützt gespeichert.'
} as const;
export function isHfOAuthCode(code: unknown): code is HfOAuthError['code'] {
    return typeof code === 'string' && Object.hasOwn(oauthMessages, code);
}
export const hfOAuthMessage = (code: HfOAuthError['code']) => oauthMessages[code];
async function hfFetch(url: string, options: RequestInit, code: HfOAuthError['code']) {
    try { return await fetch(url, options); }
    catch { throw new HfOAuthError(code, hfOAuthMessage(code)); }
}
interface Pending { account: Account; verifier: string; nonce: string; origin: string; expiresAt: number }
interface ReceivedGrant { access_token: string; expires_in: number; token_type: string; receivedAt: number; connection: string }
interface PendingDevice { account: Account; origin: string; client: string; deviceCode: string; userCode: string; verificationUrl: string; interval: number; nextPollAt: number; expiresAt: number; grant?: ReceivedGrant; completed?: { connection: string; expiresAt: number } }
interface Sealed { iv: string; data: string; expiresAt: number; keyId?: string }
export const HF_VAULT_ACCOUNT_LIMIT = 16;
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
    private operations = new Map<string, Promise<unknown>>();
    constructor(private storage: HfStorage, private config: HfConfig) {}
    private serial<T>(key: string, action: () => Promise<T>): Promise<T> {
        const result = (this.operations.get(key) || Promise.resolve()).then(action);
        const settled = result.catch(() => {});
        this.operations.set(key, settled);
        void settled.then(() => { if (this.operations.get(key) === settled) this.operations.delete(key); });
        return result;
    }
    private async key(secret = this.config.HF_OAUTH_ENCRYPTION_KEY || this.config.AUTH_COOKIE_SECRET) {
        if (!secret || secret.length < 32) throw new Error('HF-Verbindung ist noch nicht eingerichtet.');
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('slopurself-hf-v1'), info: new TextEncoder().encode('oauth-vault') }, material,
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    private async keyId(secret = this.config.HF_OAUTH_ENCRYPTION_KEY || this.config.AUTH_COOKIE_SECRET) {
        if (!secret || secret.length < 32) throw new Error('HF-Verbindung ist noch nicht eingerichtet.');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`slop-vault-key-id:${secret}`));
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
    }
    private async write<T extends { expiresAt: number }>(id: string, value: T) {
        await this.prune();
        const expiries = await this.storage.get<Record<string, number>>('hf-expiries') || {};
        const owners = await this.storage.get<Record<string, string>>('hf-entry-owners') || {};
        const owner = 'accountId' in value ? value.accountId : 'account' in value && value.account && typeof value.account === 'object' && 'id' in value.account ? value.account.id : undefined;
        if (typeof owner !== 'string' || !owner || owner.length > 128) throw new Error('HF-Zugang hat keinen gültigen Profilinhaber.');
        if (!expiries[id] && Object.values(owners).filter(accountId => accountId === owner).length >= HF_VAULT_ACCOUNT_LIMIT) throw new Error('Zu viele aktive HF-Verbindungen für dieses Profil. Bitte unbenutzte Verbindungen trennen oder später erneut versuchen.');
        if (!expiries[id] && Object.keys(expiries).length >= 512) throw new Error('Zu viele HF-Verbindungen. Bitte später erneut versuchen.');
        const keyId = await this.keyId(), iv = crypto.getRandomValues(new Uint8Array(12));
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${id}:${keyId}`) }, await this.key(), bytes);
        expiries[id] = value.expiresAt;
        owners[id] = owner;
        // Register cleanup before writing reusable secrets. A crash may leave
        // a bounded empty slot, never an unindexed encrypted token indefinitely.
        await this.storage.put('hf-expiries', expiries);
        await this.storage.put('hf-entry-owners', owners);
        await this.storage.put(id, { iv: encode(iv), data: encode(new Uint8Array(data)), expiresAt: value.expiresAt, keyId });
    }
    private save<T extends { expiresAt: number }>(id: string, value: T) {
        return this.serial('vault', async () => {
            await this.write(id, value);
        });
    }
    cleanup() { return this.serial('vault', () => this.prune()); }
    private async prune() {
        const expiries = await this.storage.get<Record<string, number>>('hf-expiries');
        if (!expiries) return;
        let changed = false;
        for (const [id, expiresAt] of Object.entries(expiries)) if (expiresAt <= Date.now()) { await this.storage.delete(id); delete expiries[id]; changed = true; }
        if (changed) await this.storage.put('hf-expiries', expiries);
        const owners = await this.storage.get<Record<string, string>>('hf-entry-owners');
        if (owners) {
            const retained = Object.fromEntries(Object.entries(owners).filter(([id]) => Object.hasOwn(expiries, id)));
            if (Object.keys(retained).length !== Object.keys(owners).length) await this.storage.put('hf-entry-owners', retained);
        }
        return Object.keys(expiries).length ? Math.min(...Object.values(expiries)) : undefined;
    }
    private remove(id: string) {
        return this.serial('vault', async () => {
            await this.storage.delete(id);
            const expiries = await this.storage.get<Record<string, number>>('hf-expiries') || {};
            delete expiries[id];
            await this.storage.put('hf-expiries', expiries);
            const owners = await this.storage.get<Record<string, string>>('hf-entry-owners');
            if (owners?.[id]) { delete owners[id]; await this.storage.put('hf-entry-owners', owners); }
        });
    }
    private async load<T extends { expiresAt: number }>(id: string): Promise<T | undefined> {
        const sealed = await this.storage.get<Sealed>(id);
        if (!sealed) return;
        if (sealed.expiresAt <= Date.now()) { await this.remove(id); return; }
        const active = this.config.HF_OAUTH_ENCRYPTION_KEY || this.config.AUTH_COOKIE_SECRET;
        const previous = this.config.HF_OAUTH_PREVIOUS_ENCRYPTION_KEY;
        if (previous && previous.length < 32) throw new Error('Der vorherige HF-Schlüssel ist ungültig konfiguriert.');
        for (const secret of [...new Set([active, previous].filter((value): value is string => Boolean(value)))]) {
            if (sealed.keyId && sealed.keyId !== await this.keyId(secret)) continue;
            let value: T;
            try {
                const aad = sealed.keyId ? `${id}:${sealed.keyId}` : id;
                const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(sealed.iv), additionalData: new TextEncoder().encode(aad) }, await this.key(secret), decode(sealed.data));
                value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
            } catch { continue; }
            if (!Number.isFinite(value?.expiresAt) || value.expiresAt <= Date.now()) return;
            if (!sealed.keyId || secret !== active) {
                const migrated = await this.serial('vault', async () => {
                    const current = await this.storage.get<Sealed>(id);
                    // A delayed read must not recreate a disconnected/deleted token,
                    // or overwrite a newer credential after another request updated it.
                    if (current?.iv !== sealed.iv || current.data !== sealed.data || current.keyId !== sealed.keyId) return false;
                    await this.write(id, value); return true;
                });
                if (!migrated) throw new Error('Die HF-Verbindung hat sich während der Prüfung geändert. Bitte erneut versuchen.');
            }
            return value;
        }
        throw new Error('HF-Verbindung muss erneut hergestellt werden.');
    }
    async start(account: Account, requestOrigin: string) {
        const origin = hfOrigin(requestOrigin, this.config), client = hfClient(origin, this.config);
        const state = random(), verifier = random(), nonce = random();
        const pending: Pending = { account: { id: account.id, name: account.name, expiresAt: account.expiresAt, authVersion: account.authVersion, identityProof: account.identityProof }, verifier, nonce, origin, expiresAt: Date.now() + 10 * 60_000 };
        await this.save(`hf-pending:${state}`, pending);
        const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        const url = new URL('https://huggingface.co/oauth/authorize');
        url.search = new URLSearchParams({ client_id: client, redirect_uri: `${origin}/api/hf/callback`, response_type: 'code',
            scope: 'openid profile read-billing', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent' }).toString();
        return { url: url.href.replaceAll('+', '%20'), nonce };
    }
    async finish(state: unknown, code: unknown, nonce: unknown, requestOrigin: string) {
        if (!secretId(state) || !secretId(nonce) || typeof code !== 'string' || !code || code.length > 2048) throw new Error('Ungültige HF-Anmeldeantwort.');
        return this.serial(`callback:${state}`, async () => {
            const id = `hf-pending:${state}`, pending = await this.load<Pending>(id);
            if (!pending || pending.nonce !== nonce || pending.origin !== hfOrigin(requestOrigin, this.config)) throw new HfOAuthError('state_invalid', 'HF-Anmeldung ist abgelaufen oder gehört zu einem anderen Browser.');
            await this.remove(id);
            if (pending.account.expiresAt <= Date.now() || (this.config.validateAccount && !await this.config.validateAccount(pending.account))) throw new Error('Bitte melde dich zuerst erneut im Spiel an.');
            const response = await fetch('https://huggingface.co/oauth/token', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'authorization_code', client_id: hfClient(pending.origin, this.config), code,
                    code_verifier: pending.verifier, redirect_uri: `${pending.origin}/api/hf/callback` }), signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new HfOAuthError('exchange_failed', 'Hugging Face konnte die Anmeldung nicht abschließen. Bitte erneut verbinden.');
            return this.acceptToken(await boundedJson(response, 32_768) as { access_token?: unknown; expires_in?: unknown; token_type?: unknown }, pending.account);
        });
    }
    private validToken(result: { access_token?: unknown; expires_in?: unknown; token_type?: unknown }): asserts result is { access_token: string; expires_in: number; token_type: string } {
        if (typeof result.access_token !== 'string' || result.access_token.length > 8192 || !result.access_token
            || !Number.isFinite(result.expires_in) || Number(result.expires_in) <= 0 || String(result.token_type).toLowerCase() !== 'bearer') throw new HfOAuthError('token_invalid', 'Ungültige HF-Zugangsdaten erhalten.');
    }
    private async acceptToken(result: { access_token?: unknown; expires_in?: unknown; token_type?: unknown }, account: Account, receivedAt = Date.now(), connection = random()) {
        this.validToken(result);
        const expiresAt = receivedAt + Math.min(result.expires_in, 8 * 60 * 60) * 1000;
        if (expiresAt <= Date.now()) throw new HfOAuthError('token_invalid', 'Der erhaltene HF-Zugang ist abgelaufen. Bitte erneut verbinden.');
        const identity = await hfFetch('https://huggingface.co/oauth/userinfo', { redirect: 'manual', headers: { Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(10_000) }, 'identity_failed');
        if (!identity.ok) throw new HfOAuthError('identity_failed', 'Dein HF-Konto konnte nicht verifiziert werden.');
        const user = await boundedJson(identity, 32_768) as { sub?: unknown; preferred_username?: unknown };
        if (typeof user.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.sub)
            || typeof user.preferred_username !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(user.preferred_username)) throw new HfOAuthError('identity_invalid', 'Ungültiges HF-Profil.');
        const whoResponse = await hfFetch('https://huggingface.co/api/whoami-v2', { redirect: 'manual', headers: { Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(10_000) }, 'validation_failed');
        if (!whoResponse.ok) throw new HfOAuthError('validation_failed', 'HF-Zugang kann nicht für die Videoerstellung verifiziert werden.');
        const who = await boundedJson(whoResponse, 65_536) as { id?: unknown; name?: unknown };
        if (typeof who.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(who.id) || who.name !== user.preferred_username) throw new HfOAuthError('identity_invalid', 'Widersprüchliche HF-Identität.');
        // A successful sign-in alone does not prove this token can read ZeroGPU quota.
        try { await fetchGpuQuota({ HF_TOKEN: result.access_token }); }
        catch (error) { throw new HfOAuthError(error instanceof GpuQuotaError && error.status === 403 ? 'quota_forbidden' : 'quota_unavailable', 'HF-Anmeldung erfolgreich, aber das ZeroGPU-Kontingent konnte nicht gelesen werden. Die Verbindung wurde nicht gespeichert.'); }
        // Serialized permanent bindings are separate from expiring access tokens.
        // An old name-only session cannot become the first claimant of an existing profile.
        await this.serial('identity', async () => {
            const bindings = await this.storage.get<Record<string, string>>('hf-profile-bindings') || {};
            if (bindings[account.id] ? bindings[account.id] !== who.id : account.identityProof !== 'owner') {
                throw new HfOAuthError('identity_unclaimed', 'Dieses Profil gehört zu einem anderen HF-Konto oder ist noch nicht sicher zugeordnet. Bitte nutze deinen bisherigen Browser oder lasse das bestehende Profil einmalig vom Besitzer mit einem Passwort sichern.');
            }
            if (!bindings[account.id]) { bindings[account.id] = who.id as string; await this.storage.put('hf-profile-bindings', bindings); }
        });
        await this.save(`hf-connection:${connection}`, { token: result.access_token, subject: who.id, username: user.preferred_username, expiresAt, accountId: account.id });
        return { connection, expiresAt };
    }
    async startDevice(account: Account, requestOrigin: string, previous?: string) {
        const origin = hfOrigin(requestOrigin, this.config), client = hfClient(origin, this.config);
        await this.cancelDevice(previous, account.id, origin);
        const response = await fetch('https://huggingface.co/oauth/device', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: client, scope: 'openid profile read-billing' }), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Hugging Face konnte die Verbindung nicht starten. Bitte später erneut versuchen.');
        const result = await boundedJson(response, 16_384) as { device_code?: unknown; user_code?: unknown; verification_uri?: unknown; verification_uri_complete?: unknown; interval?: unknown; expires_in?: unknown };
        const verification = new URL(String(result.verification_uri_complete || result.verification_uri));
        if (!['https://huggingface.co', 'https://hf.co'].includes(verification.origin) || verification.pathname !== '/oauth/device' || verification.username || verification.password
            || typeof result.device_code !== 'string' || !result.device_code || result.device_code.length > 8192
            || typeof result.user_code !== 'string' || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(result.user_code)
            || !Number.isFinite(result.expires_in) || Number(result.expires_in) <= 0) throw new Error('Ungültige HF-Verbindungsantwort.');
        const nonce = random(), interval = Math.max(5, Number.isFinite(result.interval) ? Number(result.interval) : 5);
        const pending: PendingDevice = { account: { id: account.id, name: account.name, expiresAt: account.expiresAt, authVersion: account.authVersion, identityProof: account.identityProof }, origin, client,
            deviceCode: result.device_code, userCode: result.user_code, verificationUrl: verification.href, interval, nextPollAt: Date.now() + interval * 1000,
            expiresAt: Date.now() + Math.min(600, Number(result.expires_in)) * 1000 };
        await this.save(`hf-device:${nonce}`, pending);
        return { ...this.deviceView(pending), nonce };
    }
    private deviceView(pending: PendingDevice) {
        return { pending: true, userCode: pending.userCode, verificationUrl: pending.verificationUrl, expiresAt: pending.expiresAt,
            retryAfter: Math.max(1, Math.ceil((pending.nextPollAt - Date.now()) / 1000)) };
    }
    private async device(nonce: string | undefined, accountId: string, origin: string) {
        if (!secretId(nonce)) return;
        const pending = await this.load<PendingDevice>(`hf-device:${nonce}`);
        if (!pending || pending.account.id !== accountId || pending.origin !== hfOrigin(origin, this.config)) return;
        return pending;
    }
    async deviceStatus(nonce: string | undefined, accountId: string, origin: string) {
        const pending = await this.device(nonce, accountId, origin);
        return pending ? this.deviceView(pending) : { pending: false };
    }
    async cancelDevice(nonce: string | undefined, accountId: string, origin: string) {
        if (!secretId(nonce)) return;
        await this.serial(`device:${nonce}`, async () => {
            if (await this.device(nonce, accountId, origin)) await this.remove(`hf-device:${nonce}`);
        });
    }
    async pollDevice(nonce: string | undefined, account: Account, origin: string) {
        if (!secretId(nonce)) return { error: 'Der HF-Code ist abgelaufen. Bitte erneut verbinden.' };
        return this.serial(`device:${nonce}`, () => this.poll(nonce, account, origin));
    }
    private async poll(nonce: string, account: Account, origin: string) {
        const pending = await this.device(nonce, account.id, origin);
        if (!pending) return { error: 'Der HF-Code ist abgelaufen. Bitte erneut verbinden.' };
        if (pending.account.expiresAt <= Date.now() || (this.config.validateAccount && !await this.config.validateAccount(pending.account))) throw new Error('Bitte melde dich zuerst erneut im Spiel an.');
        if (pending.completed) return { connected: true, ...pending.completed };
        if (pending.nextPollAt > Date.now()) return { pending: true, retryAfter: this.deviceView(pending).retryAfter };
        pending.nextPollAt = Date.now() + pending.interval * 1000;
        await this.save(`hf-device:${nonce}`, pending);
        if (!pending.grant) {
            const response = await hfFetch('https://huggingface.co/oauth/token', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: pending.client, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: pending.deviceCode }), signal: AbortSignal.timeout(15_000) }, 'exchange_failed');
            const result = await boundedJson(response, 32_768) as { error?: unknown; access_token?: unknown; expires_in?: unknown; token_type?: unknown };
            if (!response.ok) {
                if (result.error === 'authorization_pending') return { pending: true, retryAfter: pending.interval };
                if (result.error === 'slow_down') {
                    pending.interval += 5; pending.nextPollAt = Date.now() + pending.interval * 1000;
                    await this.save(`hf-device:${nonce}`, pending);
                    return { pending: true, retryAfter: pending.interval };
                }
                if (result.error === 'access_denied' || result.error === 'expired_token' || result.error === 'invalid_grant') {
                    await this.remove(`hf-device:${nonce}`);
                    return { error: result.error === 'access_denied' ? 'HF-Verbindung wurde abgelehnt.' : 'Der HF-Code ist abgelaufen. Bitte erneut verbinden.' };
                }
                throw new Error('HF-Verbindung konnte gerade nicht geprüft werden. Bitte erneut versuchen.');
            }
            this.validToken(result);
            // Persist the one-time exchange before network-dependent identity/quota checks.
            pending.grant = { access_token: result.access_token, expires_in: result.expires_in, token_type: result.token_type, receivedAt: Date.now(), connection: random() };
            await this.save(`hf-device:${nonce}`, pending);
        }
        try {
            pending.completed = await this.acceptToken(pending.grant, pending.account, pending.grant.receivedAt, pending.grant.connection);
        } catch (error) {
            if (error instanceof HfOAuthError && ['token_invalid', 'identity_invalid', 'identity_unclaimed', 'quota_forbidden'].includes(error.code)) {
                await this.remove(`hf-device:${nonce}`);
                return { error: error.message };
            }
            throw error;
        }
        pending.grant = undefined;
        await this.save(`hf-device:${nonce}`, pending);
        return { connected: true, ...pending.completed };
    }
    async credential(connection: string | undefined, accountId: string | undefined) {
        if (!secretId(connection) || !accountId) throw new HfRequiredError();
        const value = await this.load<HfCredential>(`hf-connection:${connection}`);
        if (!value || value.accountId !== accountId
            || (await this.storage.get<Record<string, string>>('hf-profile-bindings'))?.[accountId] !== value.subject) throw new HfRequiredError();
        return value;
    }
    async status(connection: string | undefined, accountId: string) {
        if (!connection) return { connected: false };
        let credential: HfCredential;
        try { credential = await this.credential(connection, accountId); }
        catch { return { connected: false, error: 'HF-Verbindung ist abgelaufen. Bitte erneut verbinden.' }; }
        const { username, expiresAt, token } = credential;
        try {
            const quota = await fetchGpuQuota({ HF_TOKEN: token });
            return { connected: true, username, expiresAt, remainingSeconds: Math.floor(quota.current), totalSeconds: quota.base };
        } catch { return { connected: true, username, expiresAt, quotaUnavailable: true, error: 'Dein HF-Konto bleibt verbunden. Das Kontingent ist vorübergehend nicht erreichbar.' }; }
    }
    async identityMatches(connection: string | undefined, accountId: string) {
        try {
            const credential = await this.credential(connection, accountId);
            return (await this.storage.get<Record<string, string>>('hf-profile-bindings'))?.[accountId] === credential.subject;
        } catch { return false; }
    }
    async disconnect(connection: string | undefined, accountId: string) {
        if (!connection) return;
        try { await this.credential(connection, accountId); } catch { return; }
        await this.remove(`hf-connection:${connection}`);
    }
    async pinJob(connection: string, accountId: string, jobId: string) {
        await this.save(`hf-job:${jobId}`, await this.credential(connection, accountId));
    }
    async jobCredential(jobId: string) {
        const credential = await this.load<HfCredential>(`hf-job:${jobId}`);
        if (!credential) throw new Error('Der HF-Zugang des KI-Auftrags ist abgelaufen.');
        return credential;
    }
    async forgetJob(jobId: string) { await this.remove(`hf-job:${jobId}`); }
}
