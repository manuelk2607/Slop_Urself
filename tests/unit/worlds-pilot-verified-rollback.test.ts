import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pilotArtifact,type PilotArtifact} from '../../tools/worlds-pilot-assets.mts';
import {verifiedCompatibility,verifiedApi,verifiedRollback,type VerifiedPilotApi} from '../../tools/worlds-pilot-verified-rollback.mts';
import type {Version} from '../../tools/worlds-pilot-rollback.mts';
const baseline='00000000-0000-4000-8000-000000000001',candidate='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003',commit='a'.repeat(40);
const digest=createHash('sha256').update('reviewed bytes').digest('hex');
const assets=[{path:'/',sha256:digest}];
const artifact:PilotArtifact={commit,digest:createHash('sha256').update(JSON.stringify(assets)).digest('hex'),assets};
function version(id:string):Version{return {id,resources:{script:{etag:'identical-bytecode'},script_runtime:{compatibility_date:'2026-10-03'},bindings:[
 ...Object.entries({AI_PROVIDER:'mock',WORLDS_PILOT_DEPLOYMENT:'true',WORLDS_PILOT_ENABLED:'true',WORLDS_PILOT_ORIGIN:'https://slopurself-worlds-pilot.maki26.workers.dev',WORLDS_PILOT_DATABASE_HOST:'ep-muddy-dawn-b1fl6foa-pooler.c-5.eu-central-1.aws.neon.tech',WORLDS_PILOT_COMMIT_SHA:commit,WORLDS_PILOT_ASSET_SHA256:artifact.digest}).map(([name,text])=>({type:'plain_text',name,text})),
 {type:'secret_text',name:'DATABASE_URL'},{type:'secret_text',name:'AUTH_COOKIE_SECRET'},{type:'assets',name:'ASSETS'},
 {type:'durable_object_namespace',name:'ROOMS',namespace_id:'qa-only'},{type:'version_metadata',name:'WORLDS_PILOT_VERSION'}]}};}
function fixture(){
 let generation=0,versions=[{version_id:baseline,percentage:100}];const actions:string[]=[],proofs:string[]=[];
 const api:VerifiedPilotApi={
  async current(){return {id:String(generation),versions:structuredClone(versions)}},async version(id){return version(id)},
  async deploy(id){actions.push('deploy:'+id);generation++;versions=[{version_id:id,percentage:100}]},
  async stage(b,c){actions.push('stage');generation++;versions=[{version_id:b,percentage:100},{version_id:c,percentage:0}]},
  async smoke(){actions.push('smoke')},async versionProof(id){proofs.push('version:'+id)},
  async assetProof(id){assert.deepEqual(versions,[{version_id:baseline,percentage:100},{version_id:candidate,percentage:0}]);proofs.push('assets:'+id)},
 };
 return {api,actions,proofs,get versions(){return versions},foreign(){generation++;versions=[{version_id:foreign,percentage:100}]} };
}
test('complete artifact enumeration is deterministic and refuses symlinks, extra HTML and dynamic paths',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'worlds-pilot-assets-'));
 try{
  for(const file of ['index.html','script.js','style.css','favicon.ico','README.md','robots.txt','sitemap.xml','_headers'])await writeFile(join(directory,file),'reviewed '+file);
  const a=await pilotArtifact(directory,commit),b=await pilotArtifact(directory,commit);assert.deepEqual(a,b);assert.equal(a.assets.length,5);assert.equal(a.assets[0].path,'/');
  assert.ok(!a.assets.some(a=>/robots|sitemap|_headers/.test(a.path)));
  await writeFile(join(directory,'script.js'),'changed bytes');assert.notEqual((await pilotArtifact(directory,commit)).digest,a.digest);
  await writeFile(join(directory,'other.html'),'extra');await assert.rejects(pilotArtifact(directory,commit),/additional HTML/);await rm(join(directory,'other.html'));
  await symlink(join(directory,'script.js'),join(directory,'linked.js'));await assert.rejects(pilotArtifact(directory,commit),/Symlinks/);await rm(join(directory,'linked.js'));
  await assert.rejects(pilotArtifact(directory,'unknown'),/Exact reviewed/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('metadata attestation requires the exact commit and asset digest plus identical code, configuration and resources',()=>{
 const a=version(baseline),b=version(candidate);b.resources.bindings.reverse();assert.doesNotThrow(()=>verifiedCompatibility(a,b,artifact));
 for(const mutate of [(v:Version)=>v.resources.script.etag='different',
  (v:Version)=>v.resources.bindings.find(b=>b.name==='WORLDS_PILOT_COMMIT_SHA')!.text='c'.repeat(40),
  (v:Version)=>v.resources.bindings.find(b=>b.name==='WORLDS_PILOT_ASSET_SHA256')!.text='d'.repeat(64),
  (v:Version)=>v.resources.bindings.find(b=>b.name==='ROOMS')!.namespace_id='foreign',
  (v:Version)=>v.resources.bindings=v.resources.bindings.filter(b=>b.type!=='version_metadata'),
  (v:Version)=>v.resources.script_runtime.compatibility_date='different']){
  const changed=version(candidate);mutate(changed);assert.throws(()=>verifiedCompatibility(a,changed,artifact));
 }
});
test('all bytes of both proven versions are checked at zero percent before promotion and original restoration',async()=>{
 const f=fixture(),reports:unknown[]=[];await verifiedRollback(f.api,candidate,artifact,r=>reports.push(r));
 assert.deepEqual(f.actions,['smoke','stage','deploy:'+candidate,'smoke','deploy:'+baseline,'smoke']);
 assert.deepEqual(f.proofs,['version:'+baseline,'assets:'+baseline,'assets:'+candidate,'version:'+candidate,'version:'+baseline]);
 assert.deepEqual(f.versions,[{version_id:baseline,percentage:100}]);assert.equal(reports.length,4);
});
test('failed asset proof never promotes the candidate and removes its zero-percent staging',async()=>{
 const f=fixture();f.api.assetProof=async()=>{throw new Error('asset mismatch')};
 await assert.rejects(verifiedRollback(f.api,candidate,artifact,()=>{}),/asset mismatch/);
 assert.deepEqual(f.actions,['smoke','stage','deploy:'+baseline,'smoke']);assert.equal(f.versions[0].version_id,baseline);
});
test('ambiguous stage and promotion responses are inspected and restored without retrying the write',async()=>{
 for(const operation of ['stage','deploy'] as const){
  const f=fixture();if(operation==='stage'){const stage=f.api.stage;f.api.stage=async(...args)=>{await stage(...args);throw new Error('timeout after stage')}}
  else {const deploy=f.api.deploy;f.api.deploy=async id=>{await deploy(id);if(id===candidate)throw new Error('timeout after promotion')}}
  await assert.rejects(verifiedRollback(f.api,candidate,artifact,()=>{}),/timeout/);
  assert.equal(f.versions[0].version_id,baseline);assert.equal(f.actions.filter(a=>a==='stage').length,1);
  assert.equal(f.actions.filter(a=>a==='deploy:'+candidate).length,operation==='deploy'?1:0);
 }
});
test('intervening foreign deployment is never overwritten by verified rollback cleanup',async()=>{
 const f=fixture();f.api.assetProof=async()=>{f.foreign();throw new Error('concurrent')};
 await assert.rejects(verifiedRollback(f.api,candidate,artifact,()=>{}),/Concurrent deployment/);
 assert.equal(f.versions[0].version_id,foreign);assert.ok(!f.actions.some(a=>a.startsWith('deploy:')));
});
test('incompatible artifact refuses all deployment writes',async()=>{
 const f=fixture();await assert.rejects(verifiedRollback(f.api,candidate,{...artifact,commit:'f'.repeat(40)},()=>{}));assert.deepEqual(f.actions,[]);
 await assert.rejects(verifiedRollback(f.api,baseline,artifact,()=>{}),/already active/);
});
test('live artifact proof rejects silent version fallback, changed bytes, redirects and private-path attempts',async()=>{
 let mode='ok',calls=0;
 const transport=(async(input,init)=>{
  calls++;assert.equal(String(input),'https://slopurself-worlds-pilot.maki26.workers.dev/');assert.equal(init?.redirect,'manual');
  assert.equal(new Headers(init?.headers).get('Cloudflare-Workers-Version-Overrides'),'slopurself-worlds-pilot="'+candidate+'"');
  return new Response(mode==='changed'?'other':'reviewed bytes',{status:mode==='redirect'?302:200,headers:{'x-worlds-pilot-version':mode==='fallback'?baseline:candidate,'cache-control':'no-store','x-robots-tag':'noindex'}});
 }) as typeof fetch;
 const api=verifiedApi('fixture-only',transport);await api.assetProof(candidate,artifact);
 for(const failure of ['changed','fallback','redirect']){mode=failure;await assert.rejects(api.assetProof(candidate,artifact));}
 for(const path of ['//foreign.test/','/../api/session','/bad?query=1','/api/session','/auth/login','/%2e%2e/'])await assert.rejects(api.assetProof(candidate,{...artifact,assets:[{path,sha256:digest}]}));
 assert.equal(calls,4);
});
test('zero-percent API is restricted to the fixed worker and sends no force option',async()=>{
 const transport=(async(input,init)=>{
  assert.equal(String(input),'https://api.cloudflare.com/client/v4/accounts/ec3c070d8e4f88d2fc533d7d797f2daa/workers/scripts/slopurself-worlds-pilot/deployments');
  const body=JSON.parse(String(init?.body));assert.deepEqual(body.versions,[{version_id:baseline,percentage:100},{version_id:candidate,percentage:0}]);assert.ok(!('force' in body));return Response.json({success:true});
 }) as typeof fetch;
 await verifiedApi('fixture-only',transport).stage(baseline,candidate);await assert.rejects(verifiedApi('fixture-only',transport).stage(baseline,baseline));
});

test('the complete clean CI build produces an attested artifact before any deployment',{skip:!process.env.CI},async()=>{
 const built=await pilotArtifact('cloudflare/public',process.env.GITHUB_SHA??'');
 for(const path of ['/','/script.js','/startup.js','/style.css','/assets/worlds-account.js','/favicon.ico'])assert.ok(built.assets.some(a=>a.path===path));
 assert.match(built.digest,/^[0-9a-f]{64}$/);
});

test('eventually consistent deployment reads are awaited without repeating any mutation',async()=>{
 const f=fixture(),read=f.api.current,stage=f.api.stage,deploy=f.api.deploy;
 let queue:Awaited<ReturnType<VerifiedPilotApi['current']>>[]=[];
 f.api.current=async()=>queue.shift()??await read();
 f.api.stage=async(...args)=>{const before=await read();await stage(...args);queue=[before,before]};
 f.api.deploy=async id=>{const before=await read();await deploy(id);queue=[before,before]};
 let pauses=0;await verifiedRollback(f.api,candidate,artifact,()=>{},async()=>{pauses++});
 assert.equal(pauses,6);assert.deepEqual(f.actions.filter(a=>a==='stage'||a.startsWith('deploy:')),['stage','deploy:'+candidate,'deploy:'+baseline]);
 assert.equal(f.versions[0].version_id,baseline);
});
