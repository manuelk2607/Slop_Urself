import type { PgQuery } from '../auth/worlds-shared/postgres-links.ts';

// Installed only by the explicitly enabled Worlds pilot, after the profile schema.
export const WORLDS_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS worlds_auth_transactions (
        id text PRIMARY KEY, payload jsonb NOT NULL, expires bigint NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS worlds_auth_sessions (
        id text PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
        sid text, payload jsonb NOT NULL, expires bigint NOT NULL
    )`,
    `ALTER TABLE worlds_auth_sessions ADD COLUMN IF NOT EXISTS local_user_id text`,
    `ALTER TABLE worlds_auth_sessions ADD COLUMN IF NOT EXISTS local_auth_version text`,
    `CREATE TABLE IF NOT EXISTS worlds_auth_replays (id text PRIMARY KEY, expires bigint NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS public.worlds_session_revocations (
        issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
        subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
        revoked_through bigint NOT NULL CHECK (revoked_through > 0),
        PRIMARY KEY (issuer,subject)
    )`,
    `REVOKE ALL ON public.worlds_session_revocations FROM PUBLIC`,
    `CREATE INDEX IF NOT EXISTS worlds_auth_sessions_identity ON worlds_auth_sessions(issuer, subject, sid)`,
    `CREATE INDEX IF NOT EXISTS worlds_auth_transactions_expiry ON worlds_auth_transactions(expires)`,
    `CREATE INDEX IF NOT EXISTS worlds_auth_sessions_expiry ON worlds_auth_sessions(expires)`,
    `CREATE INDEX IF NOT EXISTS worlds_auth_replays_expiry ON worlds_auth_replays(expires)`,
    `CREATE TABLE IF NOT EXISTS worlds_identity_links (
        issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
        subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
        local_user_id text NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
        linked_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (issuer, subject)
    )`,
    `CREATE TABLE IF NOT EXISTS worlds_link_audit (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        issuer text NOT NULL, subject text NOT NULL, local_user_id text NOT NULL,
        event text NOT NULL CHECK (event IN ('linked', 'unlinked')),
        occurred_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS worlds_migration_approvals (
        id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
        local_user_id text NOT NULL UNIQUE REFERENCES user_profiles(id),
        source_auth_version text NOT NULL,
        approved_by text NOT NULL CHECK(length(approved_by) BETWEEN 1 AND 200),
        approval_ref text NOT NULL CHECK(length(approval_ref) BETWEEN 1 AND 200),
        approved_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
        consumed_at timestamptz, UNIQUE(issuer,subject), CHECK(expires_at>approved_at)
    )`,
    `REVOKE ALL ON worlds_migration_approvals FROM PUBLIC`,
    `ALTER TABLE worlds_link_audit ADD COLUMN IF NOT EXISTS receipt_reported_at timestamptz`,
    `ALTER TABLE worlds_link_audit ADD COLUMN IF NOT EXISTS receipt_conflict_at timestamptz`,
    `CREATE INDEX IF NOT EXISTS worlds_link_audit_pending_receipt ON worlds_link_audit(issuer, id)
        WHERE receipt_reported_at IS NULL AND receipt_conflict_at IS NULL`,
    `CREATE OR REPLACE FUNCTION public.worlds_audit_unlink() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        BEGIN
            INSERT INTO public.worlds_link_audit (issuer, subject, local_user_id, event)
            VALUES (OLD.issuer, OLD.subject, OLD.local_user_id, 'unlinked');
            DELETE FROM public.worlds_auth_sessions WHERE issuer=OLD.issuer AND subject=OLD.subject;
            RETURN OLD;
        END;
        $$`,
    `CREATE OR REPLACE TRIGGER worlds_audit_unlink AFTER DELETE ON worlds_identity_links
        FOR EACH ROW EXECUTE FUNCTION public.worlds_audit_unlink()`,
    `REVOKE ALL ON FUNCTION public.worlds_audit_unlink() FROM PUBLIC`,
    `REVOKE ALL ON worlds_auth_transactions, worlds_auth_sessions, worlds_auth_replays,
        worlds_identity_links, worlds_link_audit FROM PUBLIC`
] as const;

export async function cleanupWorldsSessions(query: PgQuery, now = Date.now()) {
    // A fixed budget and the expiry indexes keep maintenance bounded even after downtime.
    await query(`
        WITH expired_transactions AS (
            SELECT id FROM worlds_auth_transactions WHERE expires <= $1
            ORDER BY expires, id LIMIT 250 FOR UPDATE SKIP LOCKED
        ), removed_transactions AS (
            DELETE FROM worlds_auth_transactions WHERE id IN (SELECT id FROM expired_transactions)
        ), expired_sessions AS (
            SELECT id FROM worlds_auth_sessions WHERE expires <= $1
            ORDER BY expires, id LIMIT 250 FOR UPDATE SKIP LOCKED
        ), removed_sessions AS (
            DELETE FROM worlds_auth_sessions WHERE id IN (SELECT id FROM expired_sessions)
        ), expired_replays AS (
            SELECT id FROM worlds_auth_replays WHERE expires <= $1
            ORDER BY expires, id LIMIT 250 FOR UPDATE SKIP LOCKED
        )
        DELETE FROM worlds_auth_replays WHERE id IN (SELECT id FROM expired_replays)
    `, [now]);
}
