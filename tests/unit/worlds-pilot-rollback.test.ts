import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeVersion,cloudflareApi,equivalentVersions,exerciseRollback,metadataFields,validatePilot,type PilotApi,type Version} from '../../tools/worlds-pilot-rollback.mts';
const baseline='00000000-0000-4000-8000-000000000001',candidate='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003';
test('modern metadata diagnostic reads only the fixed pilot and returns field names, never values',async()=>{
 const shape={assets:{config:{html_handling:'sensitive-placeholder'},jwt:'private-placeholder'},env:[{name:'private-placeholder',text:'private-placeholder'}]};
 assert.doesNotMatch(JSON.stringify(metadataFields(shape)),/private-placeholder|sensitive-placeholder/);
 const transport=(async(input,init)=>{
  assert.equal(String(input),'https://api.cloudflare.com/client/v4/accounts/ec3c070d8e4f88d2fc533d7d797f2daa/workers/workers/slopurself-worlds-pilot/versions/'+baseline);
  assert.equal(init?.method,undefined);assert.equal(init?.body,undefined);
  return Response.json({success:true,result:shape});
 }) as typeof fetch;
 assert.ok((await cloudflareApi('fixture-only-secret',transport).modernMetadataShape(baseline)).includes('assets.config.html_handling'));
 await assert.rejects(cloudflareApi('fixture-only-secret',transport).modernMetadataShape('foreign/path'));
});
function version(id:string):Version{return {id,resources:{script:{etag:'same-code-hash'},script_runtime:{compatibility_date:'2026-10-03'},bindings:[
 ...Object.entries({AI_PROVIDER:'mock',WORLDS_PILOT_DEPLOYMENT:'true',WORLDS_PILOT_ENABLED:'true',WORLDS_PILOT_ORIGIN:'https://slopurself-worlds-pilot.maki26.workers.dev',WORLDS_PILOT_DATABASE_HOST:'ep-muddy-dawn-b1fl6foa-pooler.c-5.eu-central-1.aws.neon.tech'}).map(([name,text])=>({type:'plain_text',name,text})),
 {type:'secret_text',name:'DATABASE_URL'},{type:'secret_text',name:'AUTH_COOKIE_SECRET'},
 {type:'durable_object_namespace',name:'ROOMS',namespace_id:'isolated-namespace'},
 {type:'assets',name:'ASSETS',asset_manifest_hash:'same-assets'}]}};}
function fixture(){let active=baseline,generation=0,smokes=0;const deployed:string[]=[];
 const api:PilotApi={async current(){return{id:'deployment-'+generation,versions:[{version_id:active,percentage:100}]}},async version(id){return version(id)},async deploy(id){deployed.push(id);active=id;generation++},async smoke(){smokes++}};
 return{api,deployed,get smokes(){return smokes},get active(){return active},change(id:string){active=id;generation++}};
}
test('rollback compatibility includes code, assets, namespaces, runtime, vars and secrets',()=>{
 const a=version(baseline),b=version(candidate);b.resources.bindings.reverse();assert.ok(equivalentVersions(a,b));
 for(const mutate of [(v:Version)=>v.resources.script.etag='other-code',(v:Version)=>v.resources.script_runtime.compatibility_date='2026-11-01',(v:Version)=>v.resources.bindings.find(b=>b.name==='ASSETS')!.asset_manifest_hash='other-assets',(v:Version)=>v.resources.bindings.find(b=>b.name==='ROOMS')!.namespace_id='other-namespace',(v:Version)=>v.resources.bindings.push({type:'secret_text',name:'HF_TOKEN'})]){
  const changed=version(candidate);mutate(changed);assert.equal(equivalentVersions(a,changed),false);
 }
 const unknownAssets=version(candidate);delete unknownAssets.resources.bindings.find(b=>b.name==='ASSETS')!.asset_manifest_hash;assert.equal(equivalentVersions(a,unknownAssets),false);
 const unsafe=version(candidate);unsafe.resources.bindings.find(b=>b.name==='AI_PROVIDER')!.text='real';assert.throws(()=>validatePilot(unsafe));
 unsafe.resources.bindings.find(b=>b.name==='AI_PROVIDER')!.text='mock';unsafe.resources.bindings.find(b=>b.name==='WORLDS_PILOT_DATABASE_HOST')!.text='production';assert.throws(()=>validatePilot(unsafe));
 assert.throws(()=>activeVersion({id:'split',versions:[{version_id:baseline,percentage:50},{version_id:candidate,percentage:50}]}));
});
test('successful rollback exercise verifies both versions and leaves original active',async()=>{const f=fixture();await exerciseRollback(f.api,candidate,()=>{});assert.deepEqual(f.deployed,[candidate,baseline]);assert.equal(f.active,baseline);assert.equal(f.smokes,3)});
test('failed candidate smoke still restores and checks original',async()=>{const f=fixture();let count=0;f.api.smoke=async()=>{if(++count===2)throw new Error('probe failed')};await assert.rejects(exerciseRollback(f.api,candidate,()=>{}),/probe failed/);assert.deepEqual(f.deployed,[candidate,baseline]);assert.equal(count,3)});
test('ambiguous successful POST is inspected and restored without blind retry',async()=>{const f=fixture(),deploy=f.api.deploy;f.api.deploy=async id=>{await deploy(id);if(id===candidate)throw new Error('timeout after commit')};await assert.rejects(exerciseRollback(f.api,candidate,()=>{}),/timeout after commit/);assert.deepEqual(f.deployed,[candidate,baseline]);assert.equal(f.active,baseline)});
test('an intervening deployment is never overwritten by cleanup',async()=>{const f=fixture();let count=0;f.api.smoke=async()=>{if(++count===2){f.change(foreign);throw new Error('concurrent')}};await assert.rejects(exerciseRollback(f.api,candidate,()=>{}),/Concurrent deployment/);assert.deepEqual(f.deployed,[candidate]);assert.equal(f.active,foreign)});
test('changed preflight or incompatible candidate stops before any write',async()=>{
 const f=fixture();f.api.version=async id=>{const v=version(id);if(id===candidate)v.resources.script.etag='new-code';return v};await assert.rejects(exerciseRollback(f.api,candidate,()=>{}),/identical code/);assert.deepEqual(f.deployed,[]);
 const g=fixture();g.api.smoke=async()=>{g.change(foreign)};await assert.rejects(exerciseRollback(g.api,candidate,()=>{}),/changed during preflight/);assert.deepEqual(g.deployed,[]);
});
test('API fixes worker/account and never sends force or leaks provider failures',async()=>{
 const calls:{url:string;body?:string}[]=[];
 const transport=(async(input,init)=>{calls.push({url:String(input),body:init?.body as string});return Response.json({success:true,result:{}})}) as typeof fetch;
 await cloudflareApi('fixture-only-secret',transport).deploy(candidate);
 assert.equal(calls[0].url,'https://api.cloudflare.com/client/v4/accounts/ec3c070d8e4f88d2fc533d7d797f2daa/workers/scripts/slopurself-worlds-pilot/deployments');
 const payload=JSON.parse(calls[0].body!);assert.equal(payload.versions[0].version_id,candidate);assert.ok(!('force' in payload));
 await assert.rejects(cloudflareApi('fixture-only-secret',(async()=>new Response('sensitive provider body',{status:403})) as typeof fetch).deploy(candidate),{message:'Pilot management request failed (HTTP 403)'});
});

test('live smoke consumes robots once and checks private root, sitemap and anonymous session',async()=>{
 const paths:string[]=[];
 const transport=(async(input)=>{const path=new URL(String(input)).pathname;paths.push(path);const status=path==='/sitemap.xml'?404:path==='/api/session'?401:200;
 return new Response(path==='/robots.txt'?'User-agent: *\nDisallow: /\n':'fixture',{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow, nosnippet'}})}) as typeof fetch;
 await cloudflareApi('fixture-only-secret',transport).smoke();assert.deepEqual(paths,['/','/robots.txt','/sitemap.xml','/api/session']);
 const indexed=(async()=>new Response('private',{headers:{'cache-control':'no-store'}})) as typeof fetch;
 await assert.rejects(cloudflareApi('fixture-only-secret',indexed).smoke(),/Private pilot smoke/);
});
