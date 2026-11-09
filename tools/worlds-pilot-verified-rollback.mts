import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {activeVersion,cloudflareApi,validatePilot,type Version,type PilotApi} from './worlds-pilot-rollback.mts';
import {pilotArtifact,type PilotArtifact} from './worlds-pilot-assets.mts';
class VerifiedPilotError extends Error {}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKER='slopurself-worlds-pilot',ORIGIN='https://'+WORKER+'.maki26.workers.dev';
const API='https://api.cloudflare.com/client/v4/accounts/ec3c070d8e4f88d2fc533d7d797f2daa/workers/scripts/'+WORKER;
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(value);
export interface VerifiedPilotApi extends PilotApi {
 stage(baseline:string,candidate:string):Promise<void>;
 versionProof(id:string):Promise<void>;
 assetProof(id:string,artifact:PilotArtifact):Promise<void>;
}
export function verifiedCompatibility(baseline:Version,candidate:Version,artifact:PilotArtifact){
 validatePilot(baseline);validatePilot(candidate);
 if(!/^[0-9a-f]{40}$/.test(artifact.commit)||!/^[0-9a-f]{64}$/.test(artifact.digest)||createHash('sha256').update(JSON.stringify(artifact.assets)).digest('hex')!==artifact.digest)throw new VerifiedPilotError('Invalid reviewed artifact');
 for(const version of [baseline,candidate]){
  const bindings=version.resources.bindings;
  if(!bindings.some(b=>b.type==='version_metadata'&&b.name==='WORLDS_PILOT_VERSION')||
   !bindings.some(b=>b.type==='plain_text'&&b.name==='WORLDS_PILOT_COMMIT_SHA'&&b.text===artifact.commit)||
   !bindings.some(b=>b.type==='plain_text'&&b.name==='WORLDS_PILOT_ASSET_SHA256'&&b.text===artifact.digest))throw new VerifiedPilotError('Version lacks exact reviewed artifact attestation');
 }
 // This path additionally requires every artifact byte to be fetched under a
 // proven runtime version before candidate promotion. The older hash-only gate
 // remains unchanged and cannot be bypassed by this metadata comparison alone.
 const normalized=(v:Version)=>({...v.resources,bindings:[...v.resources.bindings].sort((a,b)=>a.name.localeCompare(b.name))});
 if(canonical(normalized(baseline))!==canonical(normalized(candidate)))throw new VerifiedPilotError('Code, bindings, assets configuration or runtime differ');
}
function staged(deployment:Awaited<ReturnType<PilotApi['current']>>,baseline:string,candidate:string){
 return deployment.versions.length===2&&deployment.versions.some(v=>v.version_id===baseline&&v.percentage===100)&&deployment.versions.some(v=>v.version_id===candidate&&v.percentage===0);
}
export async function verifiedRollback(api:VerifiedPilotApi,candidate:string,artifact:PilotArtifact,report:(value:unknown)=>void=console.log){
 if(!UUID.test(candidate))throw new VerifiedPilotError('Explicit candidate UUID required');
 const initial=await api.current(),baseline=activeVersion(initial);if(candidate===baseline)throw new VerifiedPilotError('Candidate is already active');
 verifiedCompatibility(await api.version(baseline),await api.version(candidate),artifact);
 await api.smoke();await api.versionProof(baseline);
 if((await api.current()).id!==initial.id)throw new VerifiedPilotError('Deployment changed before staging');
 let attempted=false;
 try{
  attempted=true;await api.stage(baseline,candidate);
  const staging=await api.current();if(!staged(staging,baseline,candidate))throw new VerifiedPilotError('Candidate is not isolated at zero percent');
  await api.assetProof(baseline,artifact);await api.assetProof(candidate,artifact);
  if((await api.current()).id!==staging.id)throw new VerifiedPilotError('Deployment changed during byte verification');
  report({phase:'zero-percent-assets-verified',baseline,candidate,assets:artifact.assets.length,digest:artifact.digest});
  await api.deploy(candidate);if(activeVersion(await api.current())!==candidate)throw new VerifiedPilotError('Candidate promotion not confirmed');
  await api.smoke();await api.versionProof(candidate);report({phase:'candidate-verified',version:candidate});
 }finally{
  if(attempted){
   const current=await api.current();
   if(staged(current,baseline,candidate)||current.versions.length===1&&current.versions[0].percentage===100&&current.versions[0].version_id===candidate)await api.deploy(baseline);
   else if(activeVersion(current)!==baseline)throw new VerifiedPilotError('Concurrent deployment detected; refusing to overwrite');
   if(activeVersion(await api.current())!==baseline)throw new VerifiedPilotError('Original pilot version was not restored');
   await api.smoke();await api.versionProof(baseline);report({phase:'original-restored',version:baseline});
  }
 }
}
export function verifiedApi(token:string,transport:typeof fetch=fetch):VerifiedPilotApi{
 const api=cloudflareApi(token,transport);
 return {...api,
  async stage(baseline,candidate){
   if(!UUID.test(baseline)||!UUID.test(candidate)||baseline===candidate)throw new VerifiedPilotError('Invalid pilot staging versions');
   const response=await transport(API+'/deployments',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:baseline,percentage:100},{version_id:candidate,percentage:0}],annotations:{'workers/message':'Isolated zero-percent asset verification'}}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new VerifiedPilotError('Pilot zero-percent staging rejected');
   const data=await response.json() as {success:boolean};if(!data.success)throw new VerifiedPilotError('Pilot zero-percent staging rejected');
  },
  async assetProof(id,artifact){
   if(!UUID.test(id))throw new VerifiedPilotError('Invalid pilot version');
   for(const asset of artifact.assets){
    if(!/^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)$/.test(asset.path)||asset.path.startsWith('//')||asset.path.includes('..')||/^\/(api|auth|ws|socket\.io|\.well-known)(\/|$)/.test(asset.path)||['/robots.txt','/sitemap.xml'].includes(asset.path)||decodeURIComponent(asset.path).includes('..'))throw new VerifiedPilotError('Invalid artifact asset path');
    const response=await transport(ORIGIN+asset.path,{redirect:'manual',headers:{'Cloudflare-Workers-Version-Overrides':WORKER+'="'+id+'"'},signal:AbortSignal.timeout(15000)});
    if(response.status!==200||response.headers.get('x-worlds-pilot-version')!==id||response.headers.get('cache-control')!=='no-store'||!response.headers.get('x-robots-tag')?.includes('noindex')){await response.body?.cancel();throw new VerifiedPilotError('Asset request did not prove its pilot version');}
    const bytes=new Uint8Array(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new VerifiedPilotError('Served pilot asset bytes differ from the reviewed artifact');
   }
  }
 };
}
async function main(){
 if(process.env.GITHUB_REPOSITORY!=='manuelk2607/Slop_Urself'||process.env.GITHUB_REF!=='refs/heads/feature/worlds-hub-sso')throw new VerifiedPilotError('Only the reviewed pilot workflow may prepare a candidate');
 const artifact=await pilotArtifact('cloudflare/public',process.env.GITHUB_SHA??''),api=verifiedApi(process.env.CLOUDFLARE_API_TOKEN??'');
 const baseline=activeVersion(await api.current());
 // Refuse upload unless the active baseline already attests this exact artifact.
 verifiedCompatibility(await api.version(baseline),await api.version(baseline),artifact);
 const upload=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','versions','upload','--config','cloudflare/wrangler.worlds-pilot.toml','--name',WORKER,'--var','WORLDS_PILOT_COMMIT_SHA:'+artifact.commit,'--var','WORLDS_PILOT_ASSET_SHA256:'+artifact.digest],{encoding:'utf8',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'ec3c070d8e4f88d2fc533d7d797f2daa'}});
 if(upload.error||upload.status!==0)throw new VerifiedPilotError('Pilot candidate upload failed; inspect state before retrying');
 const matches=[...upload.stdout.matchAll(/Worker Version ID:\s*([0-9a-f-]{36})/g)];if(matches.length!==1)throw new VerifiedPilotError('Uploaded candidate ID could not be verified');
 const candidate=matches[0][1];console.log(JSON.stringify({phase:'candidate-uploaded',version:candidate}));
 await verifiedRollback(api,candidate,artifact);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{if(error instanceof VerifiedPilotError)console.error(error.message);console.error('Verified pilot rollback stopped. Inspect the fixed pilot state before retrying; no force is used.');process.exitCode=1;});
