import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import dotenv from 'dotenv';
import {createManagedEngine,ManagedModerationError} from '../moderation-service/src/managed.js';
import {GEMINI_MODEL} from '../moderation-service/src/gemini.js';
import {managedRuntimeVersion} from '../moderation-service/src/version.js';
if(!process.argv.includes('--execute-free-synthetic-videos')||!process.argv.includes('--confirm-unbilled-project'))throw new Error('Explicit free synthetic-video consent and unbilled project confirmation required.');
const env=dotenv.parse(await readFile('.env.local'));if(!env.GEMINI_MODERATION_API_KEY)throw new Error('Local Gemini key required');
const run=randomUUID(),directory=resolve('.local/audit-tests');await mkdir(directory,{recursive:true,mode:0o700});
const report={run,purpose:'free-synthetic-video-diagnostic',qualified:false,sufficientForQualification:false,gpuCalls:0,paidCalls:0,model:GEMINI_MODEL,modelVersion:'',requestsAttempted:0,cases:[] as object[],completedAt:'',
    limitations:['Synthetic calibration patterns only; no real-person or unlawful media, no expert or representative quality acceptance.','Every native frame is sent; batch verdicts do not prove perfect temporal understanding.','Unbilled project confirmed by the owner; provider billing configuration cannot be verified using an API key.']};
const target=resolve(directory,`managed-video-${run}.json`);const save=()=>writeFile(target,JSON.stringify(report,null,2)+'\n',{mode:0o600});await save();
const cwd=process.cwd();process.chdir('moderation-service');try{report.modelVersion=await managedRuntimeVersion('gemini-free','gemini-only');}finally{process.chdir(cwd);}
const engine=createManagedEngine({screening:'gemini-only',contextAuthorized:false,geminiKey:env.GEMINI_MODERATION_API_KEY,geminiFreeProjectConfirmed:true,maxRequests:12,
    fetcher:async(input,init)=>{if(String(input)!==`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`)throw new Error('Unapproved endpoint');report.requestsAttempted++;await save();return fetch(input,init);}});
const temporary=await mkdtemp(join(tmpdir(),'free-moderation-video-'));
try{
    for(const [i,size] of ['640x640','832x624','624x832'].entries()){
        const path=join(temporary,`synthetic-${i}.mp4`);await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`testsrc2=s=${size}:r=16:d=5.0625`,'-frames:v','81','-c:v','libx264','-pix_fmt','yuv420p',path],{timeout:20000});
        const before=Date.now();
        try{const result=await engine.output((await readFile(path)).toString('base64'),AbortSignal.timeout(120_000));report.cases.push({id:`synthetic-video-${i}`,expected:'allow',...result,elapsedMs:Date.now()-before,passed:result.decision==='allow'&&result.framesChecked===81&&result.uniqueFramesChecked>=80});}
        catch(error){report.cases.push({id:`synthetic-video-${i}`,outcome:'technical_failure',code:error instanceof ManagedModerationError?error.code:error instanceof Error&&['gemini_incomplete','gemini_model_drift','gemini_schema'].includes(error.message)?error.message:'local_failure',...(error instanceof ManagedModerationError?{httpStatus:error.httpStatus,provider:error.provider}:{}),elapsedMs:Date.now()-before});await save();break;}
        await save();
    }
}finally{report.completedAt=new Date().toISOString();await save();await rm(temporary,{recursive:true,force:true});}
console.info(JSON.stringify({reportPath:target,requestsAttempted:report.requestsAttempted,cases:report.cases,qualified:false,gpuCalls:0,paidCalls:0}));
