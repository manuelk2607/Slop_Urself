import { worldsPilotTarget, type WorldsEnv } from './worlds';
import type { PgQuery } from './worlds-shared/postgres-links.ts';
import { migrationReceiptSender } from './worlds-shared/migration-receipts.ts';

const issuer = 'https://slopurself.maki26.workers.dev';

async function receiptSender(env: WorldsEnv, identityIssuer: string) {
    const { WORLDS_RECEIPT_URL: url, WORLDS_RECEIPT_KID: kid, WORLDS_RECEIPT_KEY: secret } = env;
    if (!url && !kid && !secret) return;
    try {
        if (!url || !kid || !secret || new URL(url).hostname === 'worlds-hub.maki26.workers.dev') throw new Error();
        return await migrationReceiptSender({
            project: 'slop-urself', origin: issuer, identityIssuer, url, kid, privateJwk: secret,
        });
    } catch {
        throw new Error('Invalid Worlds receipt configuration');
    }
}

export async function reportWorldsLinks(env: WorldsEnv, query: PgQuery) {
    const identityIssuer = env.WORLDS_ISSUER;
    if (!worldsPilotTarget(env) || !identityIssuer) return;
    const send = await receiptSender(env, identityIssuer);
    if (!send) return;

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
        const result = await send({
            subject: row.subject,
            localAccountId: row.local_user_id,
            revision,
            state: row.event === 'linked' ? 'confirmed' : 'revoked',
        });
        const column = result === 'acknowledged' ? 'receipt_reported_at' : 'receipt_conflict_at';
        await query(`UPDATE worlds_link_audit SET ${column}=now()
            WHERE id=$1 AND issuer=$2 AND receipt_reported_at IS NULL AND receipt_conflict_at IS NULL`, [revision, identityIssuer]);
    }
}
