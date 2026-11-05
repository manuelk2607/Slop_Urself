import { type AuthConfig as LocalAuthConfig, profileAuthConfig, requestAccount } from './session';
import { checkPassword } from './passwords';
import type { ProfileStore } from './profiles';
import { boundedBody, backchannelLogout, callback, logout, sameOrigin, session, startLogin, type AuthConfig } from './worlds-shared/oidc.ts';
import { centralProof } from './worlds-shared/linking.ts';
import { PostgresAuthStore } from './worlds-shared/postgres-store.ts';
import type { PgQuery } from './worlds-shared/postgres-links.ts';

export interface WorldsEnv {
    WORLDS_PILOT_ENABLED?: string;
    WORLDS_PILOT_ORIGIN?: string;
    WORLDS_PILOT_DATABASE_HOST?: string;
    WORLDS_ISSUER?: string;
    WORLDS_CLIENT_ID?: string;
    WORLDS_RESOURCE?: string;
    WORLDS_REAUTH_ENABLED?: string;
    DATABASE_URL?: string;
}

const production = 'slopurself.maki26.workers.dev';
const productionDatabase = 'ep-holy-voice-b1djk94x';
export const WORLDS_PATHS = ['/auth/login', '/auth/callback', '/auth/logout', '/auth/backchannel-logout',
    '/auth/worlds', '/auth/worlds/link'];
export function worldsPilotTarget(env: WorldsEnv) {
    if (env.WORLDS_PILOT_ENABLED !== 'true' || !env.WORLDS_PILOT_DATABASE_HOST || !env.DATABASE_URL) return;
    try {
        const db = new URL(env.DATABASE_URL);
        const origin = new URL(env.WORLDS_PILOT_ORIGIN ?? '');
        if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== env.WORLDS_PILOT_DATABASE_HOST ||
            db.hostname.split('.')[0].replace(/-pooler$/, '') === productionDatabase ||
            origin.protocol !== 'https:' || origin.origin !== env.WORLDS_PILOT_ORIGIN || origin.hostname === production) return;
        return { origin: origin.origin, database: env.DATABASE_URL };
    } catch { return; }
}

export function worldsConfig(env: WorldsEnv, query: PgQuery): AuthConfig | undefined {
    const target = worldsPilotTarget(env);
    if (!target || !env.WORLDS_ISSUER || !env.WORLDS_CLIENT_ID || !env.WORLDS_RESOURCE) return;
    return {
        origin: target.origin, issuer: env.WORLDS_ISSUER, clientId: env.WORLDS_CLIENT_ID,
        algorithm: 'EdDSA', resource: env.WORLDS_RESOURCE, store: new PostgresAuthStore(query),
        returnPaths: ['/auth/worlds'], signedOutPaths: {de: '/', en: '/'},
        reauthEnabled: env.WORLDS_REAUTH_ENABLED === 'true'
    };
}

const html = (body: string, status = 200) => new Response(
    `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Worlds-Anmeldung · Slop Urself</title><main><h1>Worlds-Anmeldung</h1>${body}<p><a href="/">Zurück zum Spiel</a></p></main></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; form-action 'self' https:; base-uri 'none'; frame-ancestors 'none'" } }
);
const redirect = (path: string) => new Response(null, {status: 303, headers: {location: path, 'cache-control': 'no-store'}});
const refused = () => html('<p>Das Profil konnte nicht verknüpft werden. Prüfe deine Sitzungen und das Passwort.</p>', 403);

export async function worldsResponse(request: Request, config: AuthConfig | undefined, local: LocalAuthConfig, profiles: ProfileStore, query: PgQuery) {
    const url = new URL(request.url);
    if (!config || url.origin !== config.origin) return new Response(null, {status: 404});
    try {
        if (url.pathname === '/auth/login') return await startLogin(request, config);
        if (url.pathname === '/auth/callback') return await callback(request, config);
        if (url.pathname === '/auth/logout') return await logout(request, config);
        if (url.pathname === '/auth/backchannel-logout') return await backchannelLogout(request, config);
        if (url.pathname === '/auth/worlds/link') {
            if (request.method !== 'POST') return new Response(null, {status: 405});
            if (!config.reauthEnabled || !sameOrigin(request, config.origin)) return refused();
            const central = await centralProof(request, config).catch(() => null);
            if (!central) return refused();
            const body = new URLSearchParams(await boundedBody(request, 2048));
            const current = await session(request, config);
            if (!current || body.get('csrf') !== current.csrf) return refused();
            const account = await requestAccount(request, profileAuthConfig(local, profiles)).catch(() => null);
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
                    FOR UPDATE OF p,s
                ), inserted AS (
                    INSERT INTO worlds_identity_links (issuer, subject, local_user_id)
                    SELECT $2,$3,id FROM eligible ON CONFLICT DO NOTHING
                    RETURNING issuer, subject, local_user_id
                ), audited AS (
                    INSERT INTO worlds_link_audit (issuer, subject, local_user_id, event)
                    SELECT issuer, subject, local_user_id, 'linked' FROM inserted RETURNING id
                )
                SELECT EXISTS(SELECT 1 FROM audited) AS linked
            `, [central.sessionId, central.issuer, central.subject, account.id, version, central.authenticatedAt, account.expiresAt]);
            return result?.linked === true ? redirect('/auth/worlds') : refused();
        }
        if (url.pathname !== '/auth/worlds') return new Response(null, {status: 404});
        if (request.method !== 'GET') return new Response(null, {status: 405});
        const current = await session(request, config);
        if (!current) return html('<form action="/auth/login" method="post"><button>Mit Worlds anmelden</button></form>');
        // CSRF values are generated by the shared OIDC session store.
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(current.csrf)) return refused();
        const field = `<input type="hidden" name="csrf" value="${current.csrf}">`;
        const linked = (await query('SELECT 1 FROM worlds_identity_links WHERE issuer=$1 AND subject=$2', [current.issuer, current.sub])).length === 1;
        const action = linked ? '<p>Dein Slop-Urself-Profil ist verknüpft.</p>' :
            config.reauthEnabled ?
                `<form action="/auth/login?reauth=1" method="post"><button>Worlds-Anmeldung erneut bestätigen</button></form>
                <form action="/auth/worlds/link" method="post">${field}<label>Passwort deines aktiven Slop-Urself-Profils
                <input name="password" type="password" autocomplete="current-password" maxlength="200" required></label>
                <button>Profil verbindlich verknüpfen</button></form>` :
                '<p>Die Verknüpfung ist bis zur Abnahme der erneuten Worlds-Anmeldung gesperrt.</p>';
        return html(`${action}<form action="/auth/logout" method="post">${field}<button>Von Worlds in Slop Urself abmelden</button></form>`);
    } catch {
        return html('<p>Die Worlds-Anmeldung konnte nicht abgeschlossen werden. Bitte starte erneut.</p>', 400);
    }
}
