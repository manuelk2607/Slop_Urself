import { importJWK, SignJWT } from 'jose';
import { worldsPilotTarget, type WorldsEnv } from './worlds';
import type { PgQuery } from './worlds-shared/postgres-links.ts';
import { hash } from './worlds-shared/store.ts';

const path = '/api/migrations/receipts/slop-urself';
const issuer = 'https://slopurself.maki26.workers.dev';
const keyMaterial = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

async function receiptTarget(env: WorldsEnv) {
    const { WORLDS_RECEIPT_URL: url, WORLDS_RECEIPT_KID: kid, WORLDS_RECEIPT_KEY: secret } = env;
    if (!url && !kid && !secret) return;
    try {
        const target = new URL(url ?? '');
        if (target.protocol !== 'https:' || target.href !== target.origin + path ||
            target.hostname === 'worlds-hub.maki26.workers.dev' || !kid || !/^[A-Za-z0-9_-]{1,64}$/.test(kid)) throw new Error();
        const { kty, crv, x, d } = JSON.parse(secret ?? '') as Record<string, unknown>;
        if (kty !== 'OKP' || crv !== 'Ed25519' || typeof x !== 'string' || !keyMaterial.test(x) ||
            typeof d !== 'string' || !keyMaterial.test(d)) throw new Error();
        return { url: target.href, kid, key: await importJWK({ kty, crv, x, d }, 'EdDSA') };
    } catch {
        throw new Error('Invalid Worlds receipt configuration');
    }
}

export async function reportWorldsLinks(env: WorldsEnv, query: PgQuery) {
    const identityIssuer = env.WORLDS_ISSUER;
    if (!worldsPilotTarget(env) || !identityIssuer) return;
    const target = await receiptTarget(env);
    if (!target) return;

    const pending = await query(`
        SELECT id::text AS revision, subject, local_user_id, event FROM worlds_link_audit
        WHERE issuer=$1 AND receipt_reported_at IS NULL AND receipt_conflict_at IS NULL
        ORDER BY id LIMIT 10
    `, [identityIssuer]);
    for (const row of pending) {
        const revision = Number(row.revision);
        if (!Number.isSafeInteger(revision) || revision < 1 || typeof row.subject !== 'string' ||
            typeof row.local_user_id !== 'string' || (row.event !== 'linked' && row.event !== 'unlinked'))
            throw new Error('Invalid Worlds link audit row');
        const receipt = await new SignJWT({
            identity_issuer: identityIssuer,
            account_ref: await hash('worlds:slop-urself:' + row.local_user_id),
            revision,
            state: row.event === 'linked' ? 'confirmed' : 'revoked'
        }).setProtectedHeader({ alg: 'EdDSA', typ: 'worlds-migration-receipt+jwt', kid: target.kid })
            .setIssuer(issuer).setSubject(row.subject).setAudience(target.url)
            .setIssuedAt().setExpirationTime('2m').sign(target.key);

        let response: Response, result: { result?: string; error?: string };
        try {
            response = await fetch(target.url, { method: 'POST', headers: { 'content-type': 'application/jwt' },
                body: receipt, redirect: 'error', signal: AbortSignal.timeout(5000) });
            result = await response.json() as typeof result;
        } catch {
            throw new Error('Worlds receipt endpoint is unavailable');
        }
        const delivered = response.ok && ['stored', 'duplicate', 'stale'].includes(result?.result ?? '');
        const conflict = response.status === 409 && result?.error === 'RECEIPT_CONFLICT';
        if (!delivered && !conflict) throw new Error('Worlds receipt endpoint refused delivery');
        const column = delivered ? 'receipt_reported_at' : 'receipt_conflict_at';
        await query(`UPDATE worlds_link_audit SET ${column}=now()
            WHERE id=$1 AND issuer=$2 AND receipt_reported_at IS NULL AND receipt_conflict_at IS NULL`, [revision, identityIssuer]);
    }
}
