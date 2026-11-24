import { type AuthConfig as LocalAuthConfig, type Account, clearLocalLogin, profileAuthConfig, requestLegacyAccount } from './session';
import { checkPassword } from './passwords';
import {profileName,type ProfileStore} from './profiles';
import { boundedBody, backchannelLogout, callback, cookie, logout, readCookie, sameOrigin, session, SESSION_COOKIE, startLogin, startLoginLink, type AuthConfig } from './worlds-shared/oidc.ts';
import { centralProof } from './worlds-shared/linking.ts';
import { PostgresAuthStore } from './worlds-shared/postgres-store.ts';
import { receiveSessionRevocation, sessionEventPublicKey, sessionRevocationPath } from './worlds-shared/session-revocation.ts';
import type { PgQuery } from './worlds-shared/postgres-links.ts';
import { hash, type Session } from './worlds-shared/store.ts';
import {requestLocale,tr} from '../i18n/worlds';
import {escapeWorlds,worldsPage} from './worlds-page';
import {approvedProfile,consumeApprovedProfile} from './worlds-approved';
import { isWorldsProductionDatabase, WORLDS_PRODUCTION_ORIGIN, WORLDS_PRODUCTION_VARS } from './worlds-production';

export interface WorldsEnv {
    WORLDS_PRODUCTION_ENABLED?: string;
    WORLDS_PILOT_ENABLED?: string;
    WORLDS_PILOT_ORIGIN?: string;
    WORLDS_PILOT_DATABASE_HOST?: string;
    WORLDS_ISSUER?: string;
    WORLDS_CLIENT_ID?: string;
    WORLDS_RESOURCE?: string;
    WORLDS_REAUTH_ENABLED?: string;
    WORLDS_LEGACY_PASSWORD_LINK_ENABLED?: string;
    WORLDS_HUB_SESSION_EVENT_JWK?: string;
    WORLDS_RECEIPT_URL?: string;
    WORLDS_RECEIPT_KID?: string;
    WORLDS_RECEIPT_KEY?: string;
    WORLDS_MIGRATION_RECEIPT_PRIVATE_JWK?: string;
    DATABASE_URL?: string;
}

const production = 'slopurself.maki26.workers.dev';
const productionDatabase = 'ep-holy-voice-b1djk94x';
const productionOrigin = WORLDS_PRODUCTION_ORIGIN;
export const WORLDS_PATHS = ['/auth/login', '/auth/start', '/auth/callback', '/auth/logout', '/auth/backchannel-logout',
    '/auth/worlds', '/auth/worlds/link', '/auth/worlds/claim', '/auth/worlds/play', '/auth/worlds/new', sessionRevocationPath];
type SlopWorldsConfig = AuthConfig & {
    production?: boolean;
    legacyPasswordLink?: boolean;
    sessionEventKey?: ReturnType<typeof sessionEventPublicKey>;
};
export function worldsPilotTarget(env: WorldsEnv) {
    return env.WORLDS_PILOT_ENABLED === 'true' ? isolatedWorldsTarget(env) : undefined;
}

export function isolatedWorldsTarget(env: WorldsEnv) {
    if (!env.WORLDS_PILOT_DATABASE_HOST || !env.DATABASE_URL) return;
    try {
        const db = new URL(env.DATABASE_URL);
        const origin = new URL(env.WORLDS_PILOT_ORIGIN ?? '');
        if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== env.WORLDS_PILOT_DATABASE_HOST ||
            db.hostname.split('.')[0].replace(/-pooler$/, '') === productionDatabase ||
            origin.protocol !== 'https:' || origin.origin !== env.WORLDS_PILOT_ORIGIN || origin.hostname === production) return;
        return { origin: origin.origin, database: env.DATABASE_URL };
    } catch { return; }
}

export function worldsProductionEnabled(env: WorldsEnv) {
    if (env.WORLDS_PRODUCTION_ENABLED !== 'true' || env.WORLDS_PILOT_ENABLED === 'true' ||
        env.WORLDS_ISSUER !== WORLDS_PRODUCTION_VARS.WORLDS_ISSUER ||
        env.WORLDS_CLIENT_ID !== WORLDS_PRODUCTION_VARS.WORLDS_CLIENT_ID ||
        env.WORLDS_RESOURCE !== WORLDS_PRODUCTION_VARS.WORLDS_RESOURCE) return false;
    return isWorldsProductionDatabase(env.DATABASE_URL);
}

class SlopWorldsStore extends PostgresAuthStore {
    constructor(private readonly execute: PgQuery, private readonly sessionEvents: boolean) { super(execute, sessionEvents); }
    override async putSession(key: string, value: Session) {
        // The version snapshot is minted only at a verified callback or explicit
        // profile link. A password reset cannot be bypassed by reading the old cookie again.
        const fence = this.sessionEvents ? `WHERE NOT EXISTS (
            SELECT 1 FROM public.worlds_session_revocations WHERE issuer=$2 AND subject=$3
              AND revoked_through >= COALESCE($7::bigint,0)
        )` : '';
        const written = await this.execute(`
            INSERT INTO worlds_auth_sessions
                (id, issuer, subject, sid, payload, expires, local_user_id, local_auth_version)
            SELECT $1,$2,$3,$4,$5::jsonb,$6,p.id,p.auth_version
            FROM (SELECT 1) seed
            LEFT JOIN worlds_identity_links l ON l.issuer=$2 AND l.subject=$3
            LEFT JOIN user_profiles p ON p.id=l.local_user_id
            ${fence} RETURNING id
        `, [key, value.issuer, value.sub, value.sid ?? null, JSON.stringify(value), value.expires,
            ...(this.sessionEvents ? [value.authenticatedAt ?? null] : [])]);
        if (this.sessionEvents && !written.length) throw new Error('Worlds session predates sign-out');
    }
}

export function worldsConfig(env: WorldsEnv, query: PgQuery): SlopWorldsConfig | undefined {
    const production = worldsProductionEnabled(env);
    const origin = production ? productionOrigin : worldsPilotTarget(env)?.origin;
    if (!origin || !env.WORLDS_ISSUER || !env.WORLDS_CLIENT_ID || !env.WORLDS_RESOURCE) return;
    const sessionEventKey = sessionEventPublicKey(env.WORLDS_HUB_SESSION_EVENT_JWK);
    const legacyPasswordLink = production && env.WORLDS_LEGACY_PASSWORD_LINK_ENABLED === 'true' && !!sessionEventKey;
    return {
        origin, production, issuer: env.WORLDS_ISSUER, clientId: env.WORLDS_CLIENT_ID,
        algorithm: 'EdDSA', resource: env.WORLDS_RESOURCE, store: new SlopWorldsStore(query, !!sessionEventKey), sessionEventKey,
        returnPaths: ['/auth/worlds'], signedOutPaths: {de: '/', en: '/'},
        legacyPasswordLink,
        reauthEnabled: legacyPasswordLink || (!production && env.WORLDS_REAUTH_ENABLED === 'true')
    };
}

async function browserSessionKey(request: Request, config: AuthConfig) {
    if (new URL(request.url).origin !== config.origin) return;
    const raw = readCookie(request, SESSION_COOKIE);
    if (raw && /^[A-Za-z0-9_-]{32,128}$/.test(raw)) return hash(raw);
}

export function worldsAccounts(config: SlopWorldsConfig | undefined, query: PgQuery): LocalAuthConfig['worlds'] {
    if (!config) return;
    const { issuer } = config;
    const fence = config.sessionEventKey ? ` AND NOT EXISTS (
        SELECT 1 FROM public.worlds_session_revocations r
        WHERE r.issuer=s.issuer AND r.subject=s.subject
          AND r.revoked_through >= CASE WHEN jsonb_typeof(s.payload->'authenticatedAt')='number'
            THEN (s.payload->>'authenticatedAt')::numeric ELSE 0 END
    )` : '';
    async function readKey(key: string): Promise<Account | undefined> {
        const [row] = await query(`
            SELECT p.id,p.name,p.auth_version,s.expires
            FROM worlds_auth_sessions s
            JOIN worlds_identity_links l ON l.issuer=s.issuer AND l.subject=s.subject AND l.local_user_id=s.local_user_id
            JOIN user_profiles p ON p.id=s.local_user_id AND p.auth_version=s.local_auth_version
            WHERE s.id=$1 AND s.issuer=$2 AND s.expires>extract(epoch FROM now())*1000
              ${fence}
        `, [key, issuer]);
        if (!row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.auth_version !== 'string') return;
        return { id: row.id, name: row.name, expiresAt: Number(row.expires), authVersion: row.auth_version, worldsSessionKey: key };
    }
    return {
        centralRegistration: config.production === true,
        async legacyAllowed(account){
            const [link] = await query(config.sessionEventKey ? `
                SELECT extract(epoch FROM l.linked_at)*1000 AS linked_at,r.revoked_through
                FROM worlds_identity_links l LEFT JOIN public.worlds_session_revocations r USING(issuer,subject)
                WHERE l.issuer=$1 AND l.local_user_id=$2
            ` : 'SELECT extract(epoch FROM linked_at)*1000 AS linked_at FROM worlds_identity_links WHERE issuer=$1 AND local_user_id=$2',
            [issuer, account.id]);
            if (!link) return true;
            return typeof account.issuedAt === 'number' && Number.isFinite(account.issuedAt) &&
                account.issuedAt <= Number(link.linked_at) &&
                (link.revoked_through == null || account.issuedAt > Number(link.revoked_through));
        },
        async requiresCentral(id){
            return (await query('SELECT 1 FROM worlds_identity_links WHERE issuer=$1 AND local_user_id=$2',[issuer,id])).length > 0;
        },
        async read(request) {
            const key = await browserSessionKey(request, config);
            return key ? readKey(key) : undefined;
        },
        async current(account) {
            if (!account.worldsSessionKey) return false;
            const current = await readKey(account.worldsSessionKey);
            return current?.id === account.id && current.authVersion === account.authVersion && current.expiresAt === account.expiresAt;
        },
        async signOut(request) {
            const key = await browserSessionKey(request, config);
            if (!key) return;
            await config.store.deleteSession(key);
            return cookie(SESSION_COOKIE, '', 0);
        }
    };
}

const redirect = (path: string) => new Response(null, {status: 303, headers: {location: path, 'cache-control': 'no-store'}});
const startPlaying = () => {
    const response = redirect('/');
    clearLocalLogin(response.headers, '; Secure');
    return response;
};

async function createWorldsProfile(query: PgQuery, key: string, current: Session, name: string) {
    try {
        const [result] = await query(`
            WITH eligible AS MATERIALIZED (
                SELECT s.id FROM public.worlds_auth_sessions s
                WHERE s.id=$1 AND s.issuer=$2 AND s.subject=$3
                  AND s.local_user_id IS NULL AND s.expires>extract(epoch FROM now())*1000
                  AND s.payload->>'csrf'=$4
                  AND NOT EXISTS (SELECT 1 FROM public.worlds_identity_links WHERE issuer=$2 AND subject=$3)
                  AND NOT EXISTS (
                    SELECT 1 FROM public.worlds_migration_approvals
                    WHERE issuer=$2 AND subject=$3 AND consumed_at IS NULL AND expires_at>now()
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM public.worlds_session_revocations
                    WHERE issuer=$2 AND subject=$3 AND revoked_through >= COALESCE($8::bigint,0)
                  )
                FOR UPDATE OF s
            ), profile AS (
                INSERT INTO public.user_profiles (id,name,username_key)
                SELECT $5,$6,$7 FROM eligible ON CONFLICT (username_key) DO NOTHING
                RETURNING id,auth_version
            ), linked AS (
                INSERT INTO public.worlds_identity_links (issuer,subject,local_user_id)
                SELECT $2,$3,id FROM profile RETURNING issuer,subject,local_user_id
            ), audited AS (
                INSERT INTO public.worlds_link_audit (issuer,subject,local_user_id,event)
                SELECT issuer,subject,local_user_id,'linked' FROM linked RETURNING local_user_id
            ), activated AS (
                UPDATE public.worlds_auth_sessions s
                SET local_user_id=p.id,local_auth_version=p.auth_version
                FROM profile p JOIN audited a ON a.local_user_id=p.id WHERE s.id=$1 RETURNING s.id
            )
            SELECT EXISTS(SELECT 1 FROM activated) AS created
        `, [key,current.issuer,current.sub,current.csrf,crypto.randomUUID(),name,name.toLowerCase(),current.authenticatedAt??null]);
        return result?.created === true;
    } catch (error) {
        // The identity uniqueness constraint rolls back the whole statement if another
        // session created or linked a profile for the same account first.
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return false;
        throw error;
    }
}

export async function worldsResponse(request: Request, config: SlopWorldsConfig | undefined, local: LocalAuthConfig, profiles: ProfileStore, query: PgQuery) {
    const url = new URL(request.url);
    if (!config || url.origin !== config.origin) return new Response(null, {status: 404});
    if (url.pathname === sessionRevocationPath) {
        const {sessionEventKey: key, store} = config;
        if (!key || !(store instanceof SlopWorldsStore)) {
            return new Response(null, {status: 404, headers: {'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow'}});
        }
        return receiveSessionRevocation(request, {
            signer: 'https://worlds-hub.maki26.workers.dev', audience: config.origin + sessionRevocationPath,
            identityIssuer: config.issuer, key
        }, event => store.applySessionRevocation(event));
    }
    const locale=requestLocale(request),text=(key:Parameters<typeof tr>[1])=>tr(locale,key);
    const html=(body:string,status=200)=>worldsPage(body,locale,status,config.production);
    const refused=()=>html(`<p role="alert">${text('refused')}</p><a href="/auth/worlds">${text('retry')}</a>`,403);
    const loginForm=(key:Parameters<typeof tr>[1],reauth=false)=>`<form action="/auth/login?ui_locales=${locale}${reauth?'&amp;reauth=1':''}" method="post"><button class="btn-primary">${text(key)}</button></form>`;
    const newProfileForm=(csrf:string)=>`
        <h2 data-worlds-text="newProfile">${text('newProfile')}</h2>
        <p data-worlds-text="newProfileGuide">${text('newProfileGuide')}</p>
        <form action="/auth/worlds/new?ui_locales=${locale}" method="post">
            <input type="hidden" name="csrf" value="${escapeWorlds(csrf)}">
            <label><span data-worlds-text="profileName">${text('profileName')}</span>
                <input name="username" autocomplete="nickname" maxlength="15" required>
            </label>
            <button class="btn-primary" data-worlds-text="newProfile">${text('newProfile')}</button>
        </form>`;
    const profileError=(message:'newProfileInvalid'|'newProfileUnavailable',status:number)=>html(
        `<p role="alert" data-worlds-text="${message}">${text(message)}</p><a href="/auth/worlds" data-worlds-text="retry">${text('retry')}</a>`,status,
    );
    try {
        if(url.pathname==='/auth/start')return await startLoginLink(request,config);
        if (url.pathname === '/auth/login') return await startLogin(request, config);
        if (url.pathname === '/auth/callback') return await callback(request, config);
        if (url.pathname === '/auth/logout') return await logout(request, config);
        if (url.pathname === '/auth/backchannel-logout') return await backchannelLogout(request, config);
        if (url.pathname === '/auth/worlds/new') {
            if (!config.production) return new Response(null,{status:404});
            if (request.method !== 'POST') return new Response(null,{status:405});
            if (!sameOrigin(request,config.origin)) return refused();
            const current=await session(request,config),key=await browserSessionKey(request,config);
            const body=new URLSearchParams(await boundedBody(request,2048));
            if (!current||!key||body.get('csrf')!==current.csrf) return refused();
            let name:string;
            try { name=profileName(body.get('username')); }
            catch { return profileError('newProfileInvalid',422); }
            return await createWorldsProfile(query,key,current,name) ? startPlaying() : profileError('newProfileUnavailable',409);
        }
        if (url.pathname === '/auth/worlds/play') {
            if (request.method !== 'POST') return new Response(null, {status: 405});
            if (!sameOrigin(request, config.origin)) return refused();
            const current = await session(request, config);
            const body = new URLSearchParams(await boundedBody(request, 2048));
            const account = await worldsAccounts(config, query)?.read(request);
            return current && body.get('csrf') === current.csrf && account ? startPlaying() : refused();
        }
        if (url.pathname === '/auth/worlds/claim') {
            if(request.method!=='POST')return new Response(null,{status:405});
            if(config.production||!config.reauthEnabled||!sameOrigin(request,config.origin))return refused();
            const proof=await centralProof(request,config).catch(()=>null),current=await session(request,config);
            if(!proof||!current)return refused();
            const body=new URLSearchParams(await boundedBody(request,2048));
            if(body.get('csrf')!==current.csrf)return refused();
            return await consumeApprovedProfile(query,proof,local.ADMIN_ACCOUNT_ID)?startPlaying():refused();
        }
        if (url.pathname === '/auth/worlds/link') {
            if (request.method !== 'POST') return new Response(null, {status: 405});
            if (!config.reauthEnabled || (config.production && !config.legacyPasswordLink) || !sameOrigin(request, config.origin)) return refused();
            const central = await centralProof(request, config).catch(() => null);
            if (!central) return refused();
            const body = new URLSearchParams(await boundedBody(request, 2048));
            const current = await session(request, config);
            if (!current || body.get('csrf') !== current.csrf) return refused();
            const account = await requestLegacyAccount(request, profileAuthConfig(local, profiles)).catch(() => null);
            if (!account || account.id === local.ADMIN_ACCOUNT_ID) return refused();
            const profile = await profiles.find(account.name);
            const version = account.authVersion || '0';
            if (!profile?.passwordHash || profile.id !== account.id || (profile.authVersion || '0') !== version ||
                !await checkPassword(body.get('password'), profile.passwordHash)) return refused();
            // Lock both rows through insertion. A concurrent password reset,
            // revocation or existing mapping cannot transfer local ownership.
            const [result] = await query(`
                WITH eligible AS (
                    SELECT p.id FROM user_profiles p JOIN worlds_auth_sessions s ON s.id=$1
                    WHERE s.issuer=$2 AND s.subject=$3 AND p.id=$4 AND p.auth_version=$5
                      AND p.password_hash IS NOT NULL AND s.expires>extract(epoch FROM now())*1000
                      AND (s.payload->>'authenticatedAt')::bigint=$6
                      AND $6>extract(epoch FROM now())*1000-300000
                      AND $7>extract(epoch FROM now())*1000
                      ${config.legacyPasswordLink ? `AND NOT EXISTS (
                          SELECT 1 FROM public.worlds_session_revocations r
                          WHERE r.issuer=s.issuer AND r.subject=s.subject AND r.revoked_through >= $6
                      ) AND NOT EXISTS (
                          SELECT 1 FROM public.worlds_link_audit a WHERE a.local_user_id=p.id
                      ) AND NOT EXISTS (
                          SELECT 1 FROM public.worlds_migration_approvals a
                          WHERE (a.local_user_id=p.id OR (a.issuer=s.issuer AND a.subject=s.subject))
                            AND a.consumed_at IS NULL AND a.expires_at>now()
                      )` : ''}
                    FOR UPDATE OF p,s
                ), inserted AS (
                    INSERT INTO worlds_identity_links (issuer, subject, local_user_id)
                    SELECT $2,$3,id FROM eligible ON CONFLICT DO NOTHING
                    RETURNING issuer, subject, local_user_id
                ), audited AS (
                    INSERT INTO worlds_link_audit (issuer, subject, local_user_id, event${config.legacyPasswordLink ? ', legacy_password_verified' : ''})
                    SELECT issuer, subject, local_user_id, 'linked'${config.legacyPasswordLink ? ', true' : ''}
                    FROM inserted RETURNING local_user_id
                ), activated AS (
                    UPDATE worlds_auth_sessions s SET local_user_id=a.local_user_id, local_auth_version=$5
                    FROM audited a WHERE s.id=$1 RETURNING s.id
                )
                SELECT EXISTS(SELECT 1 FROM activated) AS linked
            `, [central.sessionId, central.issuer, central.subject, account.id, version, central.authenticatedAt, account.expiresAt]);
            return result?.linked === true ? startPlaying() : refused();
        }
        if (url.pathname !== '/auth/worlds') return new Response(null, {status: 404});
        if (request.method !== 'GET') return new Response(null, {status: 405});
        const current = await session(request, config);
        if (!current) return html(`<p>${text('signedOut')}</p><a class="btn-primary worlds-primary-link" href="/auth/start?ui_locales=${locale}">${text('signIn')}</a>`);
        // CSRF values are generated by the shared OIDC session store.
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(current.csrf)) return refused();
        const field = `<input type="hidden" name="csrf" value="${current.csrf}">`;
        const passwordLinkForm = () => `<p data-worlds-text="ownership">${text('ownership')}</p>
            <form action="/auth/worlds/link?ui_locales=${locale}" method="post">${field}
                <label><span data-worlds-text="password">${text('password')}</span>
                    <input name="password" type="password" autocomplete="current-password" maxlength="200" required></label>
                <p data-worlds-text="keepData">${text('keepData')}</p>
                <button class="btn-primary" data-worlds-text="link">${text('link')}</button>
            </form>`;
        const linked = (await query('SELECT 1 FROM worlds_identity_links WHERE issuer=$1 AND subject=$2', [current.issuer, current.sub])).length === 1;
        const account = linked && await worldsAccounts(config, query)?.read(request);
        const approved=!linked&&!config.production&&config.reauthEnabled?await approvedProfile(query,current.issuer,current.sub,local.ADMIN_ACCOUNT_ID):undefined;
        const status=`<section class="worlds-status" role="status"><p>✓ ${text('signedIn')}</p><h2>${text(linked?'linked':'pending')}</h2>${current.name?`<small>${escapeWorlds(current.name)}</small>`:''}</section>`;
        let action:string;
        if(account)action=`<p>${text('linkedBody')}</p><p><strong>${escapeWorlds(account.name)}</strong></p><form action="/auth/worlds/play" method="post">${field}<button class="btn-primary">${text('play')}</button></form>`;
        else if(linked)action=`<p>${text('renew')}</p>${loginForm('renewAction')}`;
        else if(config.production){
            const reserved=await approvedProfile(query,current.issuer,current.sub,local.ADMIN_ACCOUNT_ID);
            const legacy = config.legacyPasswordLink && !reserved
                ? await requestLegacyAccount(request,profileAuthConfig(local,profiles)).catch(() => null) : null;
            const profile = legacy && legacy.id !== local.ADMIN_ACCOUNT_ID ? await profiles.find(legacy.name) : null;
            if (legacy && profile?.id === legacy.id && profile.passwordHash) {
                const fresh = typeof current.authenticatedAt === 'number' && current.authenticatedAt <= Date.now()
                    && current.authenticatedAt > Date.now() - 300_000;
                action = `<h2 data-worlds-text="localProfile">${text('localProfile')}</h2><p><strong>${escapeWorlds(legacy.name)}</strong></p>`;
                action += fresh ? passwordLinkForm() : `<p data-worlds-text="freshNeeded">${text('freshNeeded')}</p>${loginForm('reauth',true)}`;
            } else {
                action=`<p data-worlds-text="productionPending">${text('productionPending')}</p>${reserved?'':newProfileForm(current.csrf)}`;
            }
        }
        else if(!config.reauthEnabled)action=`<p>${text('locked')}</p>`;
        else if(approved){
            const fresh=typeof current.authenticatedAt==='number'&&Number.isFinite(current.authenticatedAt)&&current.authenticatedAt<=Date.now()&&Date.now()-current.authenticatedAt<300000;
            action=`<h2>${text('approvedTitle')}</h2><p><strong>${escapeWorlds(approved.name)}</strong></p><p>${text('approvedBody')}</p>`;
            action+=fresh?`<form action="/auth/worlds/claim" method="post">${field}<p>${text('keepData')}</p><button class="btn-primary">${text('claim')}</button></form>`:`<p>${text('freshNeeded')}</p>${loginForm('reauth',true)}`;
        }
        else{
            const legacy=await requestLegacyAccount(request,profileAuthConfig(local,profiles)).catch(()=>null);
            if(!legacy)action=`<p>${text('localFirst')}</p>`;
            else{
                const profile=await profiles.find(legacy.name);
                const eligible=profile?.id===legacy.id&&!!profile.passwordHash&&legacy.id!==local.ADMIN_ACCOUNT_ID;
                const fresh=typeof current.authenticatedAt==='number'&&Number.isFinite(current.authenticatedAt)&&current.authenticatedAt<=Date.now()+5000&&Date.now()-current.authenticatedAt<300000;
                action=`<h2>${text('localProfile')}</h2><p><strong>${escapeWorlds(legacy.name)}</strong></p>`;
                if(!eligible)action+=`<p>${text('unavailable')}</p>`;
                else if(!fresh)action+=`<p>${text('freshNeeded')}</p>${loginForm('reauth',true)}`;
                else action+=passwordLinkForm();
            }
        }
        return html(`${status}${action}<form class="worlds-logout" action="/auth/logout" method="post">${field}<button class="btn-muted">${text('logout')}</button><p>${text('logoutHint')}</p></form>`);
    } catch {
        return html(`<p role="alert">${text('failed')}</p><a href="/auth/worlds">${text('retry')}</a>`,400);
    }
}
