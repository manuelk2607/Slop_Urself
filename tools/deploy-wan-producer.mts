import {readFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import dotenv from 'dotenv';
const repo='Manuel2607/SlopUrself-Wan22-GPU-Test';
if(!process.argv.includes('--upload-paused-space'))throw new Error('Explicit --upload-paused-space and a reviewed package required.');
const index=process.argv.indexOf('--package');if(index<0||!process.argv[index+1])throw new Error('Use --package with the reviewed local package directory.');
const directory=resolve(process.argv[index+1]);if(!directory.startsWith(resolve('.local')+'/wan-producer-package-'))throw new Error('Expected a local deployment package');
const env=dotenv.parse(await readFile('.env.local'));const token=env.HF_DEPLOY_TOKEN;
if(!token)throw new Error('Set a fine-grained HF_DEPLOY_TOKEN scoped only to the designated Space in ignored .env.local. Never post it in chat.');
const permitted=['app.py','official.py','jobs.py','producer.py','prepare_official.py','official-model-lock.json','requirements.txt','README.md'];
const evidence=JSON.parse(await readFile(resolve(directory,'DEPLOYMENT.json'),'utf8'));
if(evidence.qualified!==false||evidence.defaultModelLoading!==false||Object.keys(evidence.files).sort().join()!==[...permitted].sort().join())throw new Error('Invalid deployment scope');
const contents:Record<string,Buffer>={};
for(const file of permitted){const bytes=await readFile(resolve(directory,file));if(bytes.length>512*1024||createHash('sha256').update(bytes).digest('hex')!==evidence.files[file])throw new Error('Package drift');contents[file]=bytes;}
async function api(path:string,init:RequestInit={}){
    const r=await fetch(`https://huggingface.co/api/spaces/${repo}${path}`,{...init,redirect:'error',headers:{authorization:`Bearer ${token}`,...init.headers},signal:AbortSignal.timeout(30_000)});
    if(!r.ok){await r.body?.cancel();throw new Error(`HF deployment rejected HTTP ${r.status}; no raw provider response logged`);}return r;
}
const metadata=await(await api('')).json() as {sha:string;private?:boolean;runtime?:{stage?:string;hardware?:{current?:string|null;requested?:string|null}};siblings?:{rfilename:string}[]};
if(metadata.runtime?.stage!=='PAUSED'||!/^[a-f0-9]{40}$/.test(metadata.sha))throw new Error('The designated Space must be paused; never resume or select hardware automatically.');
if(metadata.private!==true||[metadata.runtime.hardware?.current,metadata.runtime.hardware?.requested].some(v=>v!=null&&!['cpu-basic','zero-a10g'].includes(v)))throw new Error('Only the existing private free/ZeroGPU Space may be updated.');
if(metadata.siblings?.some(f=>(f.rfilename.endsWith('.py')&&!permitted.includes(f.rfilename))||f.rfilename==='pre-requirements.txt'||f.rfilename.startsWith('.env')))throw new Error('Review unlisted runtime/build inputs before uploading; nothing is deleted automatically.');
// Set only the explicitly disabled state; never activate inference. Dedicated
// signing material is local/HF only and not copied into the package or output.
let secret=env.WAN_PRODUCER_SECRET;
if(!secret){secret=randomBytes(32).toString('hex');await appendFile('.env.local',`\nWAN_PRODUCER_SECRET=${secret}\n`,{mode:0o600});}
if(secret.length<32)throw new Error('Invalid dedicated producer secret');
await(await api('/variables',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'WAN_ENABLE_MODEL_LOADING',value:'no'})})).body?.cancel();
await(await api('/secrets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'WAN_PRODUCER_SECRET',value:secret})})).body?.cancel();
const payload=[{key:'header',value:{summary:'Deploy reviewed disabled official Wan producer',description:`Application source ${evidence.sourceCommit}; CPU/unready only. No weights or GPU activation.`,parentCommit:metadata.sha}},
    ...permitted.map(path=>({key:'file',value:{path,encoding:'base64',content:contents[path].toString('base64')}}))].map(v=>JSON.stringify(v)).join('\n')+'\n';
const commit=await(await api('/commit/main',{method:'POST',headers:{'content-type':'application/x-ndjson'},body:payload})).json() as {commitOid?:string};
if(!commit.commitOid||!/^[a-f0-9]{40}$/.test(commit.commitOid))throw new Error('Deployment acknowledgement incomplete; inspect the Space before any retry.');
const after=await(await api('')).json() as {sha:string;runtime?:{stage?:string}};
if(after.sha!==commit.commitOid)throw new Error('Published source revision not confirmed; no retry.');
console.info(JSON.stringify({space:repo,sourceRevision:commit.commitOid,stage:after.runtime?.stage,modelLoading:false,gpuCalls:0,qualified:false}));
