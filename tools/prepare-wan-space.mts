import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import dotenv from 'dotenv';
// Explicitly scoped remote preparation. No local model download, inference,
// paid hardware, storage attachment or visibility change exists in this tool.
const repo='Manuel2607/SlopUrself-Wan22-GPU-Test';
const flag=process.argv.indexOf('--revision');
const revision=flag<0?'':process.argv[flag+1];
if(!process.argv.includes('--prepare-free-remote-only')||!revision||!/^[a-f0-9]{40}$/.test(revision))throw new Error('Explicit remote-only approval and --revision are required');
const env=dotenv.parse(await readFile('.env.local'));
if(!env.HF_DEPLOY_TOKEN)throw new Error('Missing scoped deployment credential; never send credentials in chat');
async function api(path:string,init:RequestInit={}){
    const response=await fetch(`https://huggingface.co/api/spaces/${repo}${path}`,{...init,redirect:'error',
        headers:{authorization:`Bearer ${env.HF_DEPLOY_TOKEN}`,...init.headers},signal:AbortSignal.timeout(30_000)});
    if(!response.ok){await response.body?.cancel();throw new Error(`HF preparation HTTP ${response.status}; no automatic retry`);}
    return response;
}
type Metadata={sha:string;private?:boolean;runtime?:{stage?:string;hardware?:{current?:string|null;requested?:string|null}}};
function assertPaused(metadata:Metadata){
    if(metadata.sha!==revision||metadata.private!==true||metadata.runtime?.stage!=='PAUSED'
        ||metadata.runtime.hardware?.requested!=='zero-a10g'
        ||(metadata.runtime.hardware.current!=null&&metadata.runtime.hardware.current!=='zero-a10g'))
        throw new Error('Expected the reviewed private paused source on existing free ZeroGPU hardware; no change made to hardware or storage');
}
assertPaused(await(await api('')).json() as Metadata);
for(const name of ['app.py','prepare_official.py','official.py']){
    const remote=await fetch(`https://huggingface.co/spaces/${repo}/resolve/${revision}/${name}`,{
        redirect:'error',headers:{authorization:`Bearer ${env.HF_DEPLOY_TOKEN}`},signal:AbortSignal.timeout(15_000)});
    if(!remote.ok||Number(remote.headers.get('content-length'))>100_000){await remote.body?.cancel();throw new Error('Remote preparation source unavailable');}
    const bytes=Buffer.from(await remote.arrayBuffer());
    const local=await readFile(`wan-service/${name}`);
    if(bytes.length>100_000||createHash('sha256').update(bytes).digest('hex')!==createHash('sha256').update(local).digest('hex'))
        throw new Error('Remote preparation source must match the locally reviewed package');
}
// The public app must independently remain blocked, even if this Space is
// started accidentally outside preparation-only mode in the future.
const game=await fetch('https://slopurself.maki26.workers.dev/api/config',{redirect:'error',signal:AbortSignal.timeout(15_000)});
if(!game.ok)throw new Error('Public release guard could not be read');
const config=await game.json() as {generationBlocked?:boolean;mockAi?:boolean;hfRequired?:boolean};
// Match the actual public API, not a local flag or a guessed private variable.
if(config.generationBlocked!==true||config.mockAi!==false||config.hfRequired!==true)throw new Error('Public personal generation must remain blocked');
for(const [key,value] of Object.entries({WAN_PREPARATION_ONLY:'yes',WAN_PREPARE_PUBLIC_WEIGHTS:'yes',WAN_ENABLE_MODEL_LOADING:'yes',HF_HUB_DISABLE_XET:'1',HF_XET_CHUNK_CACHE_SIZE_BYTES:'0',HF_HUB_DISABLE_TELEMETRY:'1'})){
    await(await api('/variables',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,value})})).body?.cancel();
}
assertPaused(await(await api('')).json() as Metadata);
// Exact existing hardware is checked again before this one start request.
// Never retry a lost acknowledgement: inspect metadata/logs instead.
const runtime=await(await api('/restart',{method:'POST'})).json() as {stage?:string};
const evidence={space:repo,sourceRevision:revision,requestedHardware:'zero-a10g',stage:runtime.stage,
    preparationOnly:true,localWeightDownloads:0,inferenceRequests:0,gpuCalls:0,qualified:false,
    storage:'Existing ephemeral Space filesystem only; no storage service requested',
    next:'Read native preflight/download/hash/init events; a restart acknowledgement is not successful model initialization'};
await writeFile('.local/audit-tests/wan-native-preparation-2026-11-01.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.info(JSON.stringify(evidence));
