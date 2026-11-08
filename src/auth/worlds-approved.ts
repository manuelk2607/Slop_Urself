import type {PgQuery} from './worlds-shared/postgres-links.ts';
import type {CentralProof} from './worlds-shared/linking.ts';

/** Operator-reviewed migrations only. No public endpoint creates these records and
 * neither a matching display name nor a caller-provided local ID authorizes a link. */
export async function approvedProfile(query:PgQuery,issuer:string,subject:string,adminId?:string){
 const [row]=await query(`SELECT p.id,p.name FROM worlds_migration_approvals a
 JOIN user_profiles p ON p.id=a.local_user_id
 WHERE a.issuer=$1 AND a.subject=$2 AND a.consumed_at IS NULL AND a.expires_at>now()
 AND a.source_auth_version=coalesce(p.auth_version,'0') AND p.password_hash IS NULL
 AND p.id IS DISTINCT FROM $3`,[issuer,subject,adminId??null]);
 return typeof row?.id==='string'&&typeof row.name==='string'?{id:row.id,name:row.name}:undefined;
}
export async function consumeApprovedProfile(query:PgQuery,proof:CentralProof,adminId?:string){
 const newVersion=crypto.randomUUID();
 const [row]=await query(`WITH eligible AS MATERIALIZED (
 SELECT a.id AS approval_id,p.id AS local_user_id FROM worlds_migration_approvals a
 JOIN user_profiles p ON p.id=a.local_user_id
 JOIN worlds_auth_sessions s ON s.issuer=a.issuer AND s.subject=a.subject
 WHERE s.id=$1 AND a.issuer=$2 AND a.subject=$3 AND a.consumed_at IS NULL
 AND a.expires_at>now() AND a.source_auth_version=coalesce(p.auth_version,'0')
 AND p.password_hash IS NULL AND p.id IS DISTINCT FROM $4
 AND s.expires>extract(epoch FROM now())*1000
 AND (s.payload->>'authenticatedAt')::bigint=$5
 AND $5>extract(epoch FROM now())*1000-300000 AND $5<=extract(epoch FROM now())*1000
 FOR UPDATE OF a,p,s
 ), inserted AS (
 INSERT INTO worlds_identity_links(issuer,subject,local_user_id)
 SELECT $2,$3,local_user_id FROM eligible ON CONFLICT DO NOTHING RETURNING *
 ), audited AS (
 INSERT INTO worlds_link_audit(issuer,subject,local_user_id,event)
 SELECT issuer,subject,local_user_id,'linked' FROM inserted RETURNING local_user_id
 ), locked_profile AS (
 UPDATE user_profiles p SET auth_version=$6 FROM audited a WHERE p.id=a.local_user_id
 RETURNING p.id,p.auth_version
 ), consumed AS (
 UPDATE worlds_migration_approvals a SET consumed_at=now()
 FROM eligible e,locked_profile p WHERE a.id=e.approval_id AND p.id=e.local_user_id
 RETURNING a.local_user_id
 ), activated AS (
 UPDATE worlds_auth_sessions s SET local_user_id=c.local_user_id,local_auth_version=p.auth_version
 FROM consumed c JOIN locked_profile p ON p.id=c.local_user_id WHERE s.id=$1 RETURNING s.id
 ) SELECT EXISTS(SELECT 1 FROM activated) AS linked`,
 [proof.sessionId,proof.issuer,proof.subject,adminId??null,proof.authenticatedAt,newVersion]);
 return row?.linked===true;
}

/** Privileged offline migration after project-owner review, not exposed by HTTP.
 * It also handles users with no active browser session. Existing central sessions
 * for the exact approved subject retain their IDs and receive the profile snapshot. */
export async function applyApprovedMigration(query:PgQuery,approvalId:string,adminId?:string){
 if(!/^[0-9a-f-]{36}$/.test(approvalId))throw new Error('Invalid migration approval');
 const [row]=await query(`WITH eligible AS MATERIALIZED (
 SELECT a.id,a.issuer,a.subject,p.id AS local_user_id,coalesce(p.auth_version,'0') AS auth_version
 FROM worlds_migration_approvals a JOIN user_profiles p ON p.id=a.local_user_id
 WHERE a.id=$1 AND a.consumed_at IS NULL AND a.expires_at>now()
 AND a.source_auth_version=coalesce(p.auth_version,'0') AND p.password_hash IS NULL
 AND p.id IS DISTINCT FROM $2 FOR UPDATE OF a,p
 ), inserted AS (
 INSERT INTO worlds_identity_links(issuer,subject,local_user_id)
 SELECT issuer,subject,local_user_id FROM eligible ON CONFLICT DO NOTHING RETURNING *
 ), audited AS (
 INSERT INTO worlds_link_audit(issuer,subject,local_user_id,event)
 SELECT issuer,subject,local_user_id,'linked' FROM inserted RETURNING *
 ), consumed AS (
 UPDATE worlds_migration_approvals a SET consumed_at=now() FROM audited l
 WHERE a.id=$1 AND a.issuer=l.issuer AND a.subject=l.subject AND a.local_user_id=l.local_user_id
 RETURNING a.issuer,a.subject,a.local_user_id
 ), activated AS (
 UPDATE worlds_auth_sessions s SET local_user_id=c.local_user_id,local_auth_version=e.auth_version
 FROM consumed c JOIN eligible e ON e.local_user_id=c.local_user_id
 WHERE s.issuer=c.issuer AND s.subject=c.subject AND s.expires>extract(epoch FROM now())*1000 RETURNING s.id
 ) SELECT EXISTS(SELECT 1 FROM consumed) AS linked`,[approvalId,adminId??null]);
 return row?.linked===true;
}
