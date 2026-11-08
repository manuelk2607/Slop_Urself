import {pathToFileURL} from 'node:url';

const ACCOUNT='ec3c070d8e4f88d2fc533d7d797f2daa';
const WORKER='slopurself-worlds-pilot';
const ORIGIN=`https://${WORKER}.maki26.workers.dev`;
const API=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Binding={type:string;name:string;[key:string]:unknown};
export type Version={id:string;resources:{bindings:Binding[];script:{etag:string};script_runtime:Record<string,unknown>}};
type Deployment={id:string;versions:{version_id:string;percentage:number}[]};
export interface PilotApi {current():Promise<Deployment>;version(id:string):Promise<Version>;deploy(id:string):Promise<void>;smoke():Promise<void>}
class PilotCheckError extends Error {}
function fail(message:string):never{throw new PilotCheckError(message);}
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export function activeVersion(deployment:Deployment):string {
 const versions=deployment?.versions;
 if(!Array.isArray(versions)||versions.length!==1||versions[0].percentage!==100||!UUID.test(versions[0].version_id))fail('Expected one active pilot version at 100 percent');
 return versions[0].version_id;
}
export function validatePilot(version:Version):void {
 if(!UUID.test(version?.id)||!version.resources?.script?.etag||!version.resources.script_runtime||!Array.isArray(version.resources.bindings))fail('Incomplete pilot version metadata');
 const bindings=version.resources.bindings;
 if(new Set(bindings.map(b=>b.name)).size!==bindings.length)fail('Duplicate version bindings');
 const expected={AI_PROVIDER:'mock',WORLDS_PILOT_DEPLOYMENT:'true',WORLDS_PILOT_ENABLED:'true',WORLDS_PILOT_ORIGIN:ORIGIN,WORLDS_PILOT_DATABASE_HOST:'ep-muddy-dawn-b1fl6foa-pooler.c-5.eu-central-1.aws.neon.tech'};
 for(const [name,value] of Object.entries(expected))if(!bindings.some(b=>b.type==='plain_text'&&b.name===name&&b.text===value))fail('Version is not the isolated mock-only pilot');
 for(const name of ['DATABASE_URL','AUTH_COOKIE_SECRET'])if(!bindings.some(b=>b.name===name&&b.type==='secret_text'))fail('Pilot runtime secrets missing');
 if(bindings.some(b=>!['plain_text','secret_text','assets','durable_object_namespace'].includes(b.type)))fail('Unexpected pilot resource binding');
}
export function equivalentVersions(baseline:Version,candidate:Version):boolean {
 validatePilot(baseline);validatePilot(candidate);
 // Include code, assets, namespace IDs, all vars, secret metadata and runtime.
 // Cloudflare remains responsible for checking opaque secret value compatibility.
 const assets=baseline.resources.bindings.filter(b=>b.type==='assets');
 if(assets.some(b=>typeof b.asset_manifest_hash!=='string'||!b.asset_manifest_hash))return false;
 const normalized=(v:Version)=>({...v.resources,bindings:[...v.resources.bindings].sort((a,b)=>a.name.localeCompare(b.name))});
 return canonical(normalized(baseline))===canonical(normalized(candidate));
}
export async function exerciseRollback(api:PilotApi,candidateId:string,report:(value:unknown)=>void=console.log):Promise<void>{
 if(!UUID.test(candidateId))fail('Expected an explicit candidate version UUID');
 const initial=await api.current(),baselineId=activeVersion(initial);
 if(candidateId===baselineId)fail('Candidate must differ from the active version');
 const [baseline,candidate]=await Promise.all([api.version(baselineId),api.version(candidateId)]);
 if(!equivalentVersions(baseline,candidate))fail('Rollback exercise requires identical code, bindings and runtime');
 await api.smoke();
 if((await api.current()).id!==initial.id)fail('Pilot deployment changed during preflight');
 let attempted=false;
 try{
  attempted=true;await api.deploy(candidateId);
  if(activeVersion(await api.current())!==candidateId)fail('Candidate is not serving all pilot traffic');
  await api.smoke();report({phase:'candidate-verified',version:candidateId});
 }finally{
  if(attempted){
   // A timed-out POST may already have succeeded. Inspect state before restoring.
   const current=activeVersion(await api.current());
   if(current===candidateId)await api.deploy(baselineId);
   else if(current!==baselineId)fail('Concurrent deployment detected; refusing to overwrite it');
   if(activeVersion(await api.current())!==baselineId)fail('Original pilot version was not restored');
   await api.smoke();report({phase:'original-restored',version:baselineId});
  }
 }
}
export function cloudflareApi(token:string,transport:typeof fetch=fetch):PilotApi & {versions():Promise<Version[]>} {
 if(!token)fail('Pilot deployment secret missing');
 async function request(path:string,body?:unknown){
  const response=await transport(API+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)fail('Pilot management request failed (HTTP '+response.status+')');
  const envelope=await response.json() as {success:boolean;result:unknown};
  if(envelope.success!==true)fail('Pilot management request was rejected');return envelope.result;
 }
 return {
  async versions(){const result=await request('/versions?deployable=true') as {items:Version[]};if(!Array.isArray(result.items))fail('Invalid pilot versions response');return result.items;},
  async current(){const result=await request('/deployments') as {deployments:Deployment[]};return result.deployments?.[0]??fail('No current pilot deployment');},
  async version(id){if(!UUID.test(id))fail('Invalid version UUID');return await request('/versions/'+id) as Version;},
  async deploy(id){if(!UUID.test(id))fail('Invalid version UUID');await request('/deployments',{strategy:'percentage',versions:[{version_id:id,percentage:100}],annotations:{'workers/message':'Controlled isolated pilot rollback exercise'}});},
  async smoke(){
   for(const [path,status] of [['/',200],['/robots.txt',200],['/sitemap.xml',404],['/api/session',401]] as const){
    let response:Response|undefined;
    for(let attempt=0;attempt<12;attempt++){
     response=await transport(ORIGIN+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});
     if(response.status!==503)break;
     await response.body?.cancel();if(attempt<11)await new Promise(resolve=>setTimeout(resolve,3000));
    }
    if(response?.status!==status||!response.headers.get('x-robots-tag')?.includes('noindex')||response.headers.get('cache-control')!=='no-store')fail('Private pilot smoke check failed');
    if(path==='/robots.txt'){if(!/Disallow: \//.test(await response.text()))fail('Pilot robots protection missing');}
    else await response.body?.cancel();
   }
  }
 };
}
async function main(){
 const mode=process.argv[2]??'inspect',api=cloudflareApi(process.env.CLOUDFLARE_API_TOKEN??'');
 if(mode==='exercise'){await exerciseRollback(api,process.env.PILOT_ROLLBACK_VERSION??'');return;}
 if(mode!=='inspect')fail('Unknown pilot rollback operation');
 const current=await api.current(),id=activeVersion(current),version=await api.version(id);
 console.log(JSON.stringify({phase:'metadata-read',version:id,resourceFields:Object.keys(version.resources??{}),bindings:version.resources?.bindings?.map(b=>({name:b.name,type:b.type,fields:Object.keys(b)}))}));
 validatePilot(version);await api.smoke();
 // Output IDs and field names only. Binding values and provider envelopes stay private.
 const recent=(await api.versions()).slice(0,10),compatible:string[]=[];
 for(const row of recent){if(row.id===id)continue;try{if(equivalentVersions(version,await api.version(row.id)))compatible.push(row.id);}catch{/* Old versions may predate pilot guards. */}}
 console.log(JSON.stringify({worker:WORKER,deployment:current.id,version:id,codeEtag:version.resources.script.etag,resourceFields:Object.keys(version.resources),bindings:version.resources.bindings.map(b=>({name:b.name,type:b.type,fields:Object.keys(b)})),compatibleCandidates:compatible}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof PilotCheckError?error.message:'Pilot request could not be verified');console.error('Pilot rollback operation failed. Inspect verified state before retrying; no force override is used.');process.exitCode=1;});
