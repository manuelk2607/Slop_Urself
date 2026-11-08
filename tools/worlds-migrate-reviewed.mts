import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {Pool} from 'pg';
import {WORLDS_SCHEMA} from '../src/database/worlds-schema.ts';
import {applyApprovedMigration} from '../src/auth/worlds-approved.ts';

// Intentionally fixed to the restored test branch. This is not a production importer.
const HOST='ep-muddy-dawn-b1fl6foa-pooler.c-5.eu-central-1.aws.neon.tech';
const ISSUER='https://ep-bold-boat-batl101c.neonauth.c-8.eu-central-1.aws.neon.tech/worlds_identity/auth';
const tables=['user_profiles','rooms','players','rounds','votes','video_history'] as const;
function pool(uri:string,host:string){const url=new URL(uri);assert.equal(url.hostname,host);url.searchParams.delete('sslmode');url.searchParams.delete('channel_binding');return new Pool({connectionString:url.href,ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:15000});}
async function main(){
 const input=createInterface({input:process.stdin,terminal:false});
 let qa:Pool|undefined,parent:Pool|undefined;
 try{
  const lines=input[Symbol.asyncIterator](),data=JSON.parse((await lines.next()).value!);
  assert.ok(data.mode==='preview'||data.mode==='apply');const expected=data.approval;
  assert.equal(typeof expected.profile.name,'string');assert.ok(expected.profile.name.length>=1&&expected.profile.name.length<=15);assert.equal(expected.profile.protected,false);assert.equal(expected.central.issuer,ISSUER);assert.equal(expected.central.verified,true);
  assert.match(expected.profile.id,/^[0-9a-f-]{36}$/);assert.match(expected.central.subject,/^[0-9a-f-]{36}$/);
  qa=pool(data.qa,HOST);
  const parentHost=new URL(data.parent).hostname;assert.ok(parentHost==='ep-bold-boat-batl101c-pooler.c-8.eu-central-1.aws.neon.tech'||parentHost==='ep-bold-boat-batl101c.c-8.eu-central-1.aws.neon.tech');
  parent=pool(data.parent,parentHost);
  const native=await parent.query('SELECT id,"emailVerified" FROM neon_auth."user" WHERE id=$1',[expected.central.subject]);assert.equal(native.rows.length,1);assert.equal(native.rows[0].emailVerified,true);
  const client=await qa.connect();
  const snapshot=async()=>{const rows=[];for(const table of tables){const r=await client.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t`);rows.push({table,...r.rows[0]});}return rows;};
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
   const before=await snapshot();
   const source=await client.query('SELECT id,name,password_hash IS NOT NULL AS protected,auth_version FROM user_profiles WHERE id=$1 FOR UPDATE',[expected.profile.id]);assert.equal(source.rows.length,1);assert.equal(source.rows[0].name,expected.profile.name);assert.equal(source.rows[0].protected,false);assert.equal(source.rows[0].auth_version||'0',expected.profile.authVersion||'0');
   const existing=await client.query('SELECT 1 FROM worlds_identity_links WHERE (issuer=$1 AND subject=$2) OR local_user_id=$3',[ISSUER,expected.central.subject,expected.profile.id]);assert.equal(existing.rows.length,0);
   for(const statement of WORLDS_SCHEMA.filter(sql=>sql.includes('worlds_migration_approvals')))await client.query(statement);
   const id=crypto.randomUUID();
   await client.query(`INSERT INTO worlds_migration_approvals(id,issuer,subject,local_user_id,source_auth_version,approved_by,approval_ref,expires_at) VALUES($1,$2,$3,$4,$5,'project-owner','project-owner-reviewed-2026-11-08',now()+interval '1 hour')`,[id,ISSUER,expected.central.subject,expected.profile.id,expected.profile.authVersion||'0']);
   const query=async(text:string,values?:unknown[])=>(await client.query(text,values)).rows;
   assert.equal(await applyApprovedMigration(query,id),true);assert.equal(await applyApprovedMigration(query,id),false);
   assert.ok(isDeepStrictEqual(before,await snapshot()));
   const mapped=await client.query('SELECT local_user_id FROM worlds_identity_links WHERE issuer=$1 AND subject=$2',[ISSUER,expected.central.subject]);assert.equal(mapped.rows[0].local_user_id,expected.profile.id);
   if(data.mode==='apply')await client.query('COMMIT');else{
    await client.query('ROLLBACK');assert.ok(isDeepStrictEqual(before,await snapshot()));
    const rolled=await client.query('SELECT 1 FROM worlds_identity_links WHERE issuer=$1 AND subject=$2',[ISSUER,expected.central.subject]);assert.equal(rolled.rows.length,0);
   }
   console.log(JSON.stringify({mode:data.mode,profile:expected.profile.name,sixSourceTablesUnchanged:true,oneUse:true,rollbackVerified:data.mode==='preview',productionUntouched:true}));
  }catch{await client.query('ROLLBACK').catch(()=>{});throw new Error('Reviewed migration checks failed');}finally{client.release();}
 }finally{input.close();await qa?.end();await parent?.end();}
}
main().catch(()=>{console.error('Reviewed test migration failed; no credentials or account records printed. Inspect actual state before retrying.');process.exitCode=1;});
