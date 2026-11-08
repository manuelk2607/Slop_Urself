import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {SignJWT} from 'jose';
import {sqlProfiles} from '../../src/auth/profiles';import {hashPassword} from '../../src/auth/passwords';
import {approvedProfile,applyApprovedMigration,consumeApprovedProfile} from '../../src/auth/worlds-approved';
import {WORLDS_SCHEMA} from '../../src/database/worlds-schema';import {worldsAccounts,worldsConfig} from '../../src/auth/worlds';
import {profileAuthConfig,requestAccount,sessionResponse} from '../../src/auth/session';
import {HfConnections} from '../../src/auth/huggingface';
import {SESSION_COOKIE,token} from '../../src/auth/worlds-shared/oidc.ts';import {hash} from '../../src/auth/worlds-shared/store.ts';
const issuer='https://identity.test/auth',origin='https://approved.test';
test('reviewed passwordless migration preserves profile and active Worlds sessions, blocks username reclaim and is one-use',async t=>{
 const db=new PGlite();try{
  const query=async(text:string,values?:unknown[])=>(await db.query<Record<string,unknown>>(text,values)).rows;
  const profiles=sqlProfiles(async(text,values)=>(await db.query<{id:string;name:string}>(text,values)).rows);
  const profile=(await profiles.create('Existing'))!,other=(await profiles.create('Other'))!;
  for(const sql of WORLDS_SCHEMA)await query(sql);
  const config=worldsConfig({WORLDS_PILOT_ENABLED:'true',WORLDS_PILOT_ORIGIN:origin,WORLDS_PILOT_DATABASE_HOST:'db.test',DATABASE_URL:'postgres://db.test/test',WORLDS_ISSUER:issuer,WORLDS_CLIENT_ID:'fixture',WORLDS_RESOURCE:origin+'/api'},query)!;
  const raw=token(),key=await hash(raw),subject='verified-subject';
  await config.store.putSession(key,{issuer,sub:subject,csrf:token(),expires:Date.now()+600000,authenticatedAt:Date.now()-600000});
  await config.store.putSession('other-session',{issuer,sub:'other-subject',csrf:token(),expires:Date.now()+600000});
  const signing={AUTH_COOKIE_SECRET:'fixture-only-secret-long-enough-32-characters'};
  const oldLogin=await sessionResponse(new Request(origin+'/api/session',{method:'POST',headers:{origin},body:JSON.stringify({mode:'login',username:profile.name})}),signing,profiles);
  const oldCookie=oldLogin.headers.get('set-cookie')!.split(';')[0],oldBody=await oldLogin.json();
  const beforeConfig=profileAuthConfig({...signing,worlds:worldsAccounts(config,query)},profiles);
  const oldAccount=(await requestAccount(new Request(origin+'/api/session',{headers:{cookie:oldCookie}}),beforeConfig))!;
  const vault=new Map<string,unknown>();const hf=new HfConnections({async get<T>(key:string){return vault.get(key) as T|undefined},async put(key,value){vault.set(key,value)},async delete(key){vault.delete(key)}},beforeConfig);
  const pendingHf=await hf.start(oldAccount,origin);

  const id=crypto.randomUUID();await query(`INSERT INTO worlds_migration_approvals(id,issuer,subject,local_user_id,source_auth_version,approved_by,approval_ref,expires_at) VALUES($1,$2,$3,$4,'0','project-owner','reviewed-fixture',now()+interval '1 hour')`,[id,issuer,subject,profile.id]);
  assert.deepEqual(await approvedProfile(query,issuer,subject),{id:profile.id,name:profile.name});assert.equal(await approvedProfile(query,issuer,'other-subject'),undefined);
  assert.equal(await applyApprovedMigration(query,id,profile.id),false,'Administrator exclusion remains active');
  assert.equal(await applyApprovedMigration(query,id),true);assert.equal(await applyApprovedMigration(query,id),false);
  assert.equal(await approvedProfile(query,issuer,subject),undefined);
  assert.equal((await profiles.find(profile.name))?.id,profile.id);assert.equal(!!(await profiles.find(profile.name))?.passwordHash,false);
  const worlds=worldsAccounts(config,query),local={AUTH_COOKIE_SECRET:'fixture-only-secret-long-enough-32-characters',worlds};
  const request=new Request(origin+'/api/session',{headers:{cookie:SESSION_COOKIE+'='+raw}});
  assert.equal((await requestAccount(request,profileAuthConfig(local,profiles)))?.id,profile.id,'Existing central session gains its approved game profile without another login');
  const otherSession=await config.store.getSession('other-session');assert.equal(otherSession?.sub,'other-subject');
  t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:500}));
  await assert.rejects(()=>hf.finish(new URL(pendingHf.url).searchParams.get('state'),'fixture-code',pendingHf.nonce,origin),(error:unknown)=>(error as {code?:string}).code==='exchange_failed','Pending HF authorization retains its original account proof after migration');
  const continued=await requestAccount(new Request(origin+'/api/session',{headers:{cookie:oldCookie}}),profileAuthConfig(local,profiles));assert.equal(continued?.id,profile.id);
  const refreshed=await sessionResponse(new Request(origin+'/api/session',{method:'POST',headers:{origin,cookie:oldCookie},body:JSON.stringify({mode:'refresh'})}),local,profiles);
  assert.equal(refreshed.status,200);const refreshBody=await refreshed.json();assert.equal(refreshBody.token,oldBody.token);assert.equal(refreshBody.account.expiresAt,oldBody.account.expiresAt);
  const laterToken=await new SignJWT({name:profile.name,role:'player',av:'0'}).setSubject(profile.id).setProtectedHeader({alg:'HS256'}).setIssuer('slopurself').setAudience('game').setIssuedAt(Math.floor(Date.now()/1000)+60).setExpirationTime('30d').sign(new TextEncoder().encode(signing.AUTH_COOKIE_SECRET));
  await assert.rejects(()=>requestAccount(new Request(origin+'/api/session',{headers:{cookie:'slop_auth='+laterToken}}),profileAuthConfig(local,profiles)));
  const denied=await sessionResponse(new Request(origin+'/api/session',{method:'POST',headers:{origin},body:JSON.stringify({mode:'login',username:profile.name})}),local,profiles);
  assert.equal(denied.status,409);assert.equal((await denied.json()).code,'worlds_required');
  const allowed=await sessionResponse(new Request(origin+'/api/session',{method:'POST',headers:{origin},body:JSON.stringify({mode:'login',username:other.name})}),local,profiles);assert.equal(allowed.status,200);
  assert.deepEqual(await query('SELECT event FROM worlds_link_audit'),[{event:'linked'}]);
  const [approval]=await query('SELECT consumed_at IS NOT NULL AS used FROM worlds_migration_approvals');assert.equal(approval.used,true);
  await query('DELETE FROM worlds_identity_links WHERE issuer=$1 AND subject=$2',[issuer,subject]);
  assert.equal(await config.store.getSession(key),null);assert.equal((await profiles.find(profile.name))?.id,profile.id);assert.ok(await config.store.getSession('other-session'));
 }finally{await db.close();}
});
test('expired, changed, conflicting and unapproved profiles cannot be migrated; interactive claims require fresh central proof',async()=>{
 const db=new PGlite();try{
  const query=async(text:string,values?:unknown[])=>(await db.query<Record<string,unknown>>(text,values)).rows;
  const profiles=sqlProfiles(async(text,values)=>(await db.query<{id:string;name:string}>(text,values)).rows);
  const profile=(await profiles.create('Existing'))!;for(const sql of WORLDS_SCHEMA)await query(sql);
  assert.equal(await applyApprovedMigration(query,crypto.randomUUID()),false);
  const id=crypto.randomUUID();await query(`INSERT INTO worlds_migration_approvals(id,issuer,subject,local_user_id,source_auth_version,approved_by,approval_ref,approved_at,expires_at) VALUES($1,$2,'subject',$3,'0','project-owner','reviewed-fixture',now()-interval '2 hours',now()-interval '1 hour')`,[id,issuer,profile.id]);
  assert.equal(await applyApprovedMigration(query,id),false);await query(`UPDATE worlds_migration_approvals SET expires_at=now()+interval '1 hour' WHERE id=$1`,[id]);
  await profiles.setPassword(profile.id,await hashPassword('a fixture password long enough'));assert.equal(await applyApprovedMigration(query,id),false);
  assert.equal(await consumeApprovedProfile(query,{sessionId:'missing',issuer,subject:'subject',authenticatedAt:Date.now()}),false);
  assert.deepEqual(await query('SELECT * FROM worlds_identity_links'),[]);assert.deepEqual(await query('SELECT * FROM worlds_link_audit'),[]);
 }finally{await db.close();}
});

test('public migration claim uses the approved identity only and enforces Origin, CSRF, freshness and replay protection',async()=>{
 const db=new PGlite();try{
  const query=async(text:string,values?:unknown[])=>(await db.query<Record<string,unknown>>(text,values)).rows;
  const profiles=sqlProfiles(async(text,values)=>(await db.query<{id:string;name:string}>(text,values)).rows),profile=(await profiles.create('Approved'))!,victim=(await profiles.create('Unapproved'))!;
  for(const sql of WORLDS_SCHEMA)await query(sql);
  const config=worldsConfig({WORLDS_PILOT_ENABLED:'true',WORLDS_PILOT_ORIGIN:origin,WORLDS_PILOT_DATABASE_HOST:'db.test',DATABASE_URL:'postgres://db.test/test',WORLDS_ISSUER:issuer,WORLDS_CLIENT_ID:'fixture',WORLDS_RESOURCE:origin+'/api',WORLDS_REAUTH_ENABLED:'true'},query)!;
  const raw=token(),key=await hash(raw),csrf=token(),sub='approved-subject';
  await config.store.putSession(key,{issuer,sub,csrf,expires:Date.now()+60000,authenticatedAt:Date.now()-1000});
  await query(`INSERT INTO worlds_migration_approvals(id,issuer,subject,local_user_id,source_auth_version,approved_by,approval_ref,expires_at) VALUES($1,$2,$3,$4,'0','project-owner','fixture-review',now()+interval '1 hour')`,[crypto.randomUUID(),issuer,sub,profile.id]);
  const {worldsResponse}=await import('../../src/auth/worlds');
  const post=(source=origin,antiCsrf=csrf)=>worldsResponse(new Request(origin+'/auth/worlds/claim',{method:'POST',headers:{origin:source,cookie:SESSION_COOKIE+'='+raw},body:new URLSearchParams({csrf:antiCsrf,local_user_id:victim.id,subject:'attacker'})}),config,{},profiles,query);
  assert.equal((await post('https://foreign.test')).status,403);assert.equal((await post(origin,'wrong')).status,403);
  assert.deepEqual(await query('SELECT * FROM worlds_identity_links'),[]);
  const done=await post();assert.equal(done.status,303);assert.equal(done.headers.get('location'),'/');
  assert.deepEqual(await query('SELECT local_user_id FROM worlds_identity_links'),[{local_user_id:profile.id}]);assert.equal((await post()).status,403);
 }finally{await db.close();}
});
