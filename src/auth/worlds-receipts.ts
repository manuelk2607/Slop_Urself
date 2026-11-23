import { worldsPilotTarget, worldsProductionEnabled, type WorldsEnv } from './worlds';
import { WORLDS_PRODUCTION_ORIGIN } from './worlds-production';
import type { PgQuery } from './worlds-shared/postgres-links.ts';
import { migrationReceiptSender } from './worlds-shared/migration-receipts.ts';

const hubOrigin = 'https://worlds-hub.maki26.workers.dev';
const productionReceiptUrl = hubOrigin + '/api/migrations/receipts/slop-urself';

async function receiptSender(env: WorldsEnv, identityIssuer: string, production: boolean) {
    const url = production ? productionReceiptUrl : env.WORLDS_RECEIPT_URL;
    const secret = production ? env.WORLDS_MIGRATION_RECEIPT_PRIVATE_JWK : env.WORLDS_RECEIPT_KEY;
    if (production && !secret) return;
    const pilotKid = env.WORLDS_RECEIPT_KID;
    if (!url && !pilotKid && !secret) return;
    try {
        const kid: unknown = production && secret ? JSON.parse(secret)?.kid : pilotKid;
        if (!url || typeof kid !== 'string' || !kid || !secret ||
            (!production && new URL(url).hostname === new URL(hubOrigin).hostname)) throw new Error();
        return await migrationReceiptSender({
            project: 'slop-urself', origin: WORLDS_PRODUCTION_ORIGIN, identityIssuer, url, kid, privateJwk: secret,
        });
    } catch {
        throw new Error('Invalid Worlds receipt configuration');
    }
}

export async function reportWorldsLinks(env: WorldsEnv, query: PgQuery) {
    const identityIssuer = env.WORLDS_ISSUER;
    const production = worldsProductionEnabled(env);
    if ((!production && !worldsPilotTarget(env)) || !identityIssuer) return;
    const send = await receiptSender(env, identityIssuer, production);
    if (!send) return;

    // New Worlds profiles also leave audit events. Only a consumed, exact
    // legacy approval qualifies a production event for migration reporting.
    const pending = await query(`
        SELECT audit.id::text AS revision, audit.subject, audit.local_user_id, audit.event
        FROM worlds_link_audit audit
        WHERE audit.issuer=$1 AND audit.receipt_reported_at IS NULL AND audit.receipt_conflict_at IS NULL
        ${production ? `AND EXISTS (
            SELECT 1 FROM worlds_migration_approvals approval
            WHERE (approval.issuer, approval.subject, approval.local_user_id) =
                (audit.issuer, audit.subject, audit.local_user_id)
            AND approval.consumed_at IS NOT NULL
        )` : ''}
        ORDER BY audit.id LIMIT 10
    `, [identityIssuer]);
    const totals = {acknowledged: 0, conflict: 0};
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
        const written = await query(`UPDATE worlds_link_audit SET ${column}=now()
            WHERE id=$1 AND issuer=$2 AND receipt_reported_at IS NULL AND receipt_conflict_at IS NULL
            RETURNING id`, [revision, identityIssuer]);
        if (written.length) totals[result]++;
    }
    return totals;
}
