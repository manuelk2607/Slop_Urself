import type {LinkBinding,LinkStore} from './linking.ts';

/** Adapter for the project's own Postgres client. Parameters must stay parameterized.
 * Apply the reviewed project-local schema and permissions before enabling this store. */
export type PgQuery=(text:string,values:unknown[])=>Promise<Record<string,unknown>[]>;

export class PostgresLinkStore implements LinkStore {
  private query:PgQuery;
  constructor(query:PgQuery){this.query=query;}
  async stage(proofHash:string,binding:LinkBinding){
    await this.query(`INSERT INTO worlds_link_proofs
      (proof_hash,issuer,subject,local_user_id,session_hash,expires_at)
      VALUES ($1,$2,$3,$4,$5,to_timestamp($6::double precision / 1000))`,
      [proofHash,binding.issuer,binding.subject,binding.localId,binding.sessionId,binding.expires]);
  }
  async consumeAndLink(proofHash:string,sessionId:string,now:number){
    try {
      // One Postgres statement is one transaction: a uniqueness/FK/audit failure
      // rolls back proof consumption as well. No mapping can ever be overwritten.
      const rows=await this.query(`WITH claimed AS (
        DELETE FROM worlds_link_proofs
        WHERE proof_hash=$1 AND session_hash=$2
          AND expires_at > to_timestamp($3::double precision / 1000)
        RETURNING issuer,subject,local_user_id
      ), inserted AS (
        INSERT INTO worlds_identity_links (issuer,subject,local_user_id)
        SELECT issuer,subject,local_user_id FROM claimed
        RETURNING issuer,subject,local_user_id
      ), audited AS (
        INSERT INTO worlds_link_audit (issuer,subject,local_user_id,event)
        SELECT issuer,subject,local_user_id,'linked' FROM inserted
        RETURNING id
      ) SELECT EXISTS (SELECT 1 FROM audited) AS linked`,[proofHash,sessionId,now]);
      return rows[0]?.linked===true;
    }catch(error){
      // A conflicting owner is an expected refusal, not an upsert opportunity.
      if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')return false;
      throw error;
    }
  }
  async lookup(issuer:string,subject:string){
    const rows=await this.query('SELECT local_user_id FROM worlds_identity_links WHERE issuer=$1 AND subject=$2',[issuer,subject]);
    return typeof rows[0]?.local_user_id==='string'?rows[0].local_user_id:null;
  }
}
