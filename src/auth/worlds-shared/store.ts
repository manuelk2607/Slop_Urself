export interface Identity { issuer:string; sub:string; email?:string; name?:string; sid?:string }
export interface Session extends Identity { csrf:string; expires:number; authenticatedAt?:number }
export interface Transaction { verifier:string; nonce:string; state:string; next:string; expires:number; reauth?:boolean }
export interface AuthStore {
  putTransaction(key:string,value:Transaction):Promise<void>;
  takeTransaction(key:string):Promise<Transaction|null>;
  putSession(key:string,value:Session):Promise<void>;
  getSession(key:string):Promise<Session|null>;
  deleteSession(key:string):Promise<void>;
  revokeIdentity(issuer:string,sub?:string,sid?:string):Promise<void>;
  claimReplay(key:string,expires:number):Promise<boolean>;
}
export const hash = async (v:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
interface D1Statement {
  bind(...values:unknown[]):D1Statement;
  run():Promise<{meta:{changes:number}}>;
  first<T>():Promise<T|null>;
}
interface D1StoreDatabase { prepare(sql:string):D1Statement }
export class D1AuthStore implements AuthStore {
  db:D1StoreDatabase;
  constructor(db:D1StoreDatabase) { this.db=db; }
  async putTransaction(key:string,v:Transaction) { await this.db.prepare('INSERT INTO auth_transactions (id, payload, expires) VALUES (?, ?, ?)').bind(key,JSON.stringify(v),v.expires).run(); }
  async takeTransaction(key:string) { const row=await this.db.prepare('DELETE FROM auth_transactions WHERE id = ? RETURNING payload').bind(key).first<{payload:string}>();return row?JSON.parse(row.payload) as Transaction:null; }
  async putSession(key:string,v:Session) { await this.db.prepare('INSERT INTO auth_sessions (id, issuer, subject, sid, payload, expires) VALUES (?, ?, ?, ?, ?, ?)').bind(key,v.issuer,v.sub,v.sid??null,JSON.stringify(v),v.expires).run(); }
  async getSession(key:string) { const row=await this.db.prepare('SELECT payload FROM auth_sessions WHERE id = ? AND expires > ?').bind(key,Date.now()).first<{payload:string}>();return row?JSON.parse(row.payload) as Session:null; }
  async deleteSession(key:string) { await this.db.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(key).run(); }
  async revokeIdentity(issuer:string,sub?:string,sid?:string) {
    if (!sub&&!sid) throw new Error('Missing identity');
    await this.db.prepare('DELETE FROM auth_sessions WHERE issuer = ? AND (? IS NULL OR subject = ?) AND (? IS NULL OR sid = ?)').bind(issuer,sub??null,sub??null,sid??null,sid??null).run();
  }
  async claimReplay(key:string,expires:number) { const result=await this.db.prepare('INSERT OR IGNORE INTO auth_replays (id, expires) VALUES (?, ?)').bind(key,expires).run();return result.meta.changes===1; }
}
