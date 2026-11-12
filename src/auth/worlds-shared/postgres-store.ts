import type {AuthStore,Session,Transaction} from './store.ts';
import type {PgQuery} from './postgres-links.ts';
import type {SessionRevocation} from './session-revocation.ts';

/** Server-only adapter. Each application owns these tables and credentials. */
export class PostgresAuthStore implements AuthStore {
  constructor(query:PgQuery, sessionEventsEnabled=false){
    this.query=query;
    this.sessionEventsEnabled=sessionEventsEnabled;
  }
  private query:PgQuery;
  private sessionEventsEnabled:boolean;
  async putTransaction(key:string,value:Transaction){
    await this.query('INSERT INTO public.worlds_auth_transactions(id,payload,expires) VALUES($1,$2::jsonb,$3)',[key,JSON.stringify(value),value.expires]);
  }
  async takeTransaction(key:string){
    const rows=await this.query('DELETE FROM public.worlds_auth_transactions WHERE id=$1 RETURNING payload',[key]);
    return rows[0]?.payload as Transaction|undefined??null;
  }
  async putSession(key:string,value:Session){
    const values=[key,value.issuer,value.sub,value.sid??null,JSON.stringify(value),value.expires];
    if(!this.sessionEventsEnabled){
      await this.query('INSERT INTO public.worlds_auth_sessions(id,issuer,subject,sid,payload,expires) VALUES($1,$2,$3,$4,$5::jsonb,$6)',values);
      return;
    }
    const inserted=await this.query(`INSERT INTO public.worlds_auth_sessions(id,issuer,subject,sid,payload,expires)
      SELECT $1,$2,$3,$4,$5::jsonb,$6 WHERE NOT EXISTS (
        SELECT 1 FROM public.worlds_session_revocations WHERE issuer=$2 AND subject=$3
          AND revoked_through >= COALESCE($7::bigint,0)
      ) RETURNING id`,[...values,value.authenticatedAt??null]);
    if(!inserted.length)throw new Error('Worlds session predates sign-out');
  }
  async getSession(key:string){
    const fence=this.sessionEventsEnabled?` AND NOT EXISTS (
      SELECT 1 FROM public.worlds_session_revocations r
      WHERE r.issuer=s.issuer AND r.subject=s.subject
        AND r.revoked_through >= CASE WHEN jsonb_typeof(s.payload->'authenticatedAt')='number'
          THEN (s.payload->>'authenticatedAt')::numeric ELSE 0 END
    )`:'';
    const rows=await this.query('SELECT payload FROM public.worlds_auth_sessions s WHERE id=$1 AND expires>$2'+fence,[key,Date.now()]);
    return rows[0]?.payload as Session|undefined??null;
  }
  async applySessionRevocation(event:SessionRevocation){
    if(!this.sessionEventsEnabled)throw new Error('Project session events disabled');
    // A late or duplicate event cannot lower the cutoff or remove fresh sessions.
    // The read fence also covers concurrent inserts outside this SQL snapshot.
    await this.query(`WITH advanced AS (
      INSERT INTO public.worlds_session_revocations(issuer,subject,revoked_through)
      VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO UPDATE
      SET revoked_through=EXCLUDED.revoked_through
      WHERE worlds_session_revocations.revoked_through<EXCLUDED.revoked_through
      RETURNING issuer,subject,revoked_through
    )
    DELETE FROM public.worlds_auth_sessions s USING advanced r
    WHERE s.issuer=r.issuer AND s.subject=r.subject
      AND r.revoked_through >= CASE WHEN jsonb_typeof(s.payload->'authenticatedAt')='number'
        THEN (s.payload->>'authenticatedAt')::numeric ELSE 0 END`,
    [event.identityIssuer,event.subject,event.revokedThrough]);
  }
  async deleteSession(key:string){await this.query('DELETE FROM public.worlds_auth_sessions WHERE id=$1',[key]);}
  async revokeIdentity(issuer:string,sub?:string,sid?:string){
    if(!sub&&!sid)throw new Error('Missing identity');
    await this.query('DELETE FROM public.worlds_auth_sessions WHERE issuer=$1 AND ($2::text IS NULL OR subject=$2) AND ($3::text IS NULL OR sid=$3)',[issuer,sub??null,sid??null]);
  }
  async claimReplay(key:string,expires:number){
    const rows=await this.query('INSERT INTO public.worlds_auth_replays(id,expires) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',[key,expires]);
    return rows.length===1;
  }
}
