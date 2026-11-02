import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import dotenv from 'dotenv';
import { gitMainRevision } from '../src/ai/provider-trust.js';

// This clean public copy is intentionally separate from the private Space
// uploader. No history, directory glob, media or environment file is uploaded.
const repo='Manuel2607/SlopUrself-Wan22-Validated';
const files=['app.py','official.py','jobs.py','producer.py','prepare_official.py','official-model-lock.json','requirements.txt','pre-requirements.txt','README.md'];
function argument(name:string){const index=process.argv.indexOf(name);if(index<0||!process.argv[index+1])throw Error(`Missing ${name}`);return process.argv[index+1];}
if(!process.argv.includes('--upload-disabled-public-validation'))throw Error('Explicit authorization for the clean public validation copy required');
const expected=argument('--expected-revision'),directory=resolve(argument('--package'));
if(!/^[a-f0-9]{40}$/.test(expected)||!directory.startsWith(resolve('.local')+'/wan-producer-package-'))throw Error('Invalid reviewed package/revision');
const preparation=process.argv.includes('--prepare-approved-free-remote');
const reuseScope=process.argv.includes('--reuse-reviewed-scope');
const env=dotenv.parse(await readFile('.env.local'));
if(!env.HF_DEPLOY_TOKEN||!env.WAN_PRODUCER_SECRET||env.WAN_PRODUCER_SECRET.length<32)throw Error('Local dedicated deployment/signing credentials required');
interface Metadata {sha:string;private?:boolean;runtime?:{stage?:string;hardware?:{current?:string|null;requested?:string|null}};siblings?:{rfilename:string}[]}
async function api(path:string,init:RequestInit={}){
    const response=await fetch(`https://huggingface.co/api/spaces/${repo}${path}`,{...init,redirect:'error',headers:{authorization:`Bearer ${env.HF_DEPLOY_TOKEN}`,...init.headers},signal:AbortSignal.timeout(30_000)});
    if(!response.ok){await response.body?.cancel();throw Error(`Public validation deployment rejected HTTP ${response.status}; inspect before retry, no raw response logged`);}return response;
}
const metadata=await(await api('')).json() as Metadata;
const head=gitMainRevision(await(await api('/refs')).json());
if(metadata.private!==false||head!==expected||metadata.runtime?.hardware?.requested!=='zero-a10g'
    ||metadata.runtime.hardware.current!=null&&metadata.runtime.hardware.current!=='zero-a10g'
    ||metadata.siblings?.some(f=>!['.gitattributes',...files].includes(f.rfilename)))throw Error('Target/source/free hardware differs from the approved clean copy');
const treeResponse=await api(`/tree/${head}?recursive=true`),tree=await treeResponse.json() as {path:string;type:string}[];
if(treeResponse.headers.has('link')||!Array.isArray(tree)||tree.length>files.length+1||tree.some(f=>f.type!=='file'||!['.gitattributes',...files].includes(f.path)))throw Error('Unexpected executable/file tree at the actual Git head');
const evidence=JSON.parse(await readFile(resolve(directory,'DEPLOYMENT.json'),'utf8')) as {sourceCommit:string;qualified:boolean;defaultModelLoading:boolean;files:Record<string,string>};
if(evidence.qualified!==false||evidence.defaultModelLoading!==false||!/^[a-f0-9]{40}$/.test(evidence.sourceCommit)
    ||Object.keys(evidence.files).sort().join()!==[...files].sort().join())throw Error('Invalid package scope');
const content:Record<string,Buffer>={};
for(const file of files){const data=await readFile(resolve(directory,file));if(data.length>512*1024||createHash('sha256').update(data).digest('hex')!==evidence.files[file])throw Error('Package changed');content[file]=data;}
const game=await fetch('https://slopurself.maki26.workers.dev/api/config',{redirect:'error',signal:AbortSignal.timeout(15_000)});
if(!game.ok)throw Error('Production safety gate unavailable');
const gameConfig=await game.json() as {generationBlocked?:boolean;mockAi?:boolean;hfRequired?:boolean};
if(gameConfig.generationBlocked!==true||gameConfig.mockAi!==false||gameConfig.hfRequired!==true)throw Error('Global release must remain blocked with personal HF identities required');
// Actual immutable public HF subject IDs; names alone never authorize inference.
// The production caller must still prove the same ID with its own HF token.
const subjects:string[]=[];
for(const name of ['Manuel260702','Manuel2607']){
    const response=await fetch(`https://huggingface.co/api/users/${name}/overview`,{redirect:'error',signal:AbortSignal.timeout(15_000)});
    if(!response.ok){await response.body?.cancel();throw Error('Approved HF subject unavailable');}
    const user=await response.json() as {_id?:unknown;user?:unknown};
    if(user.user!==name||typeof user._id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(user._id))throw Error('HF subject identity unavailable');subjects.push(user._id);
}
if(new Set(subjects).size!==2)throw Error('Two distinct immutable HF subjects required');
const configure=async(kind:'variables'|'secrets',key:string,value:string)=>{await(await api('/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,value})})).body?.cancel();};
const receipt=resolve(directory,'UPLOAD.json');
await writeFile(receipt,JSON.stringify({space:repo,parent:head,sourceCommit:evidence.sourceCommit,acknowledged:false})+'\n',{flag:'wx',mode:0o600});
// Always set fail-closed scope before publishing executable source. Preparation
// can download only public pinned weights remotely; it cannot route to GPU.
if(reuseScope){
    const variables=await(await api('/variables')).json() as Record<string,{value?:unknown}>;
    for(const[key,value]of Object.entries({WAN_VALIDATION_ONLY:'yes',WAN_PREPARATION_ONLY:'yes',WAN_PREPARE_PUBLIC_WEIGHTS:preparation?'yes':'no',WAN_ENABLE_MODEL_LOADING:preparation?'yes':'no'}))
        if(variables[key]?.value!==value)throw Error('Reviewed preparation variables changed; no configuration overwrite');
}else{
    await configure('variables','WAN_VALIDATION_ONLY','yes');
    await configure('secrets','WAN_VALIDATION_SUBJECTS',subjects.join(','));
    await configure('secrets','WAN_PRODUCER_SECRET',env.WAN_PRODUCER_SECRET);
    await configure('variables','WAN_PREPARATION_ONLY','yes');
    await configure('variables','WAN_PREPARE_PUBLIC_WEIGHTS',preparation?'yes':'no');
    await configure('variables','WAN_ENABLE_MODEL_LOADING',preparation?'yes':'no');
}
const body=[{key:'header',value:{summary:'Publish clean two-account Wan validation producer',description:`Reviewed source ${evidence.sourceCommit}; preparation only, no inference.`,parentCommit:expected}},
    ...files.map(path=>({key:'file',value:{path,encoding:'base64',content:content[path].toString('base64')}}))].map(v=>JSON.stringify(v)).join('\n')+'\n';
const commit=await(await api('/commit/main',{method:'POST',headers:{'content-type':'application/x-ndjson'},body})).json() as {commitOid?:string};
if(!commit.commitOid||!/^[a-f0-9]{40}$/.test(commit.commitOid))throw Error('Commit acknowledgement missing; inspect source before retry');
await writeFile(receipt,JSON.stringify({space:repo,parent:head,sourceCommit:evidence.sourceCommit,acknowledged:true,commitOid:commit.commitOid})+'\n',{mode:0o600});
const after=await(await api('')).json() as Metadata;
if(gitMainRevision(await(await api('/refs')).json())!==commit.commitOid||after.private!==false||after.runtime?.hardware?.requested!=='zero-a10g')throw Error('Published revision/free hardware not confirmed; inspect before retry');
// Read back each public file independently. Never retrieve secrets in reports.
for(const file of files){
    const response=await fetch(`https://huggingface.co/spaces/${repo}/raw/${commit.commitOid}/${file}`,{redirect:'error',signal:AbortSignal.timeout(15_000)});
    if(!response.ok){await response.body?.cancel();throw Error('Published file unavailable');}
    if(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')!==evidence.files[file])throw Error('Published file differs');
}
const report={space:repo,sourceCommit:evidence.sourceCommit,sourceRevision:commit.commitOid,stage:after.runtime.stage,
    public:true,requestedHardware:'zero-a10g',preparationOnly:true,remoteModelLoading:preparation,subjects:2,verifiedFiles:files.length,
    localWeightDownloads:0,gpuCalls:0,qualified:false};
await writeFile('.local/audit-tests/public-validation-deployment.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.info(JSON.stringify(report));
