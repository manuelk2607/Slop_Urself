import type {AuthStore,Session,Transaction} from './store.ts';
import type {PgQuery} from './postgres-links.ts';

/** Server-only adapter. Each application owns these tables and credentials. */
export class PostgresAuthStore implements AuthStore {
  constructor(privateQuery:PgQuery){this.query=privateQuery;}
  private query:PgQuery;
  async putTransaction(key:string,value:Transaction){
    await this.query('INSERT INTO public.worlds_auth_transactions(id,payload,expires) VALUES($1,$2::jsonb,$3)',[key,JSON.stringify(value),value.expires]);
  }
  async takeTransaction(key:string){
    const rows=await this.query('DELETE FROM public.worlds_auth_transactions WHERE id=$1 RETURNING payload',[key]);
    return rows[0]?.payload as Transaction|undefined??null;
  }
  async putSession(key:string,value:Session){
    await this.query('INSERT INTO public.worlds_auth_sessions(id,issuer,subject,sid,payload,expires) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[key,value.issuer,value.sub,value.sid??null,JSON.stringify(value),value.expires]);
  }
  async getSession(key:string){
    const rows=await this.query('SELECT payload FROM public.worlds_auth_sessions WHERE id=$1 AND expires>$2',[key,Date.now()]);
    return rows[0]?.payload as Session|undefined??null;
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
