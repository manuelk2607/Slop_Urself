import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moderationRequest } from '../../src/security/moderation-jobs';
import { generateAiVideo } from '../../src/ai/generation';
import { archiveVideo } from '../../src/storage/archive';
import { testImageData } from '../support/images';
import { readFile } from 'node:fs/promises';
import { testModerationConfig } from '../support/moderation-fixture';

test('async moderation polls only the fixed authenticated origin and never treats pending as approval', async () => {
    const original=globalThis.fetch, id='a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12), digest='d'.repeat(64);
    const calls: string[]=[];let reads=0;
    try {
        globalThis.fetch=async(input,options)=>{
            const url=String(input);calls.push(url);assert.equal(options?.redirect,'manual');
            assert.equal(new Headers(options?.headers).get('authorization'),'Bearer fixture-only');
            if(options?.method==='POST') return Response.json({id,digest,status:'pending',url:'https://evil.invalid/steal'},{status:202});
            assert.equal(options?.body,undefined);assert.equal(url,`https://moderation.test/jobs/${id}`);
            return ++reads===1?Response.json({digest,status:'pending'},{status:202}):Response.json({decision:'allow',digest});
        };
        const result=await moderationRequest('https://moderation.test/jobs/validate','fixture-only','{}',digest,async()=>{});
        assert.deepEqual(result,{decision:'allow',digest});assert.equal(calls.length,3);
    }finally{globalThis.fetch=original;}
});

test('lost, redirected, evaluation-only or malformed background jobs never resubmit or approve', async()=>{
    const original=globalThis.fetch,digest='e'.repeat(64),id='b'.repeat(8)+'-bbbb-bbbb-bbbb-'+'b'.repeat(12);
    try{
        for(const mode of ['lost','redirect','evaluation','bad-id','bad-digest','bad-pending']){
            let posts=0,gets=0;
            globalThis.fetch=async(_input,options)=>{
                if(options?.method==='POST'){posts++;return Response.json({id:mode==='bad-id'?'../escape':id,digest:mode==='bad-digest'?'wrong':digest,...(mode==='evaluation'?{evaluationOnly:true}:{})},{status:202});}
                gets++;
                return mode==='redirect'?new Response(null,{status:307,headers:{location:'https://evil.invalid'}}):mode==='bad-pending'?Response.json({digest,status:'complete'},{status:202}):new Response(null,{status:404});
            };
            await assert.rejects(moderationRequest('https://moderation.test/jobs/validate','fixture','{}',digest,async()=>{}));
            assert.equal(posts,1);assert.ok(gets<=1);
        }
    }finally{globalThis.fetch=original;}
});

test('unqualified, unavailable, rejected and incomplete moderation cannot trigger any GPU or archive operation', async()=>{
    const original=globalThis.fetch,video=await readFile('public/assets/mock-video.mp4');
    try{
        for(const mode of ['unqualified','block','review','evaluation','partial']){
            let hf=0,storage=0;
            globalThis.fetch=async(input,options)=>{
                const url=String(input);
                if(url==='https://moderation.test/validate'){
                    if(mode==='unqualified')return Response.json({error:'qualification_required'},{status:503});
                    return Response.json({decision:mode==='block'?'block':mode==='review'?'review':'allow',digest:new Headers(options?.headers).get('x-content-sha256'),
                        policyVersion:testModerationConfig.MODERATION_POLICY_VERSION,modelVersion:testModerationConfig.MODERATION_MODEL_VERSION,
                        ...(mode==='evaluation'?{evaluationOnly:true}:{}),decodeComplete:false});
                }
                if(url==='https://fixture.hf.space/clip.mp4')return new Response(video,{headers:{'content-type':'video/mp4'}});
                if(url.startsWith('https://storage.test'))storage++;else hf++;
                throw new Error('Forbidden downstream operation');
            };
            await assert.rejects(generateAiVideo(testImageData(1,1),'Safe test '+mode,{...testModerationConfig,AI_PROVIDER:'wan22'}));
            await assert.rejects(archiveVideo('https://fixture.hf.space/clip.mp4',{...testModerationConfig,AI_PROVIDER:'wan22',
                AWS_ACCESS_KEY_ID:'fixture',AWS_SECRET_ACCESS_KEY:'fixture',AWS_ENDPOINT_URL_S3:'https://storage.test'}));
            assert.equal(hf,0);assert.equal(storage,0);
        }
    }finally{globalThis.fetch=original;}
});

test('a previous approval cannot mask a later qualification failure for the same image and prompt',async()=>{
    const original=globalThis.fetch;let qualified=true,calls=0;
    const {moderateInput}=await import('../../src/security/moderation');
    try{
        globalThis.fetch=async(_input,options)=>{
            calls++;if(!qualified)return Response.json({error:'qualification_required'},{status:503});
            return Response.json({decision:'allow',decodeComplete:true,digest:new Headers(options?.headers).get('x-content-sha256'),
                policyVersion:testModerationConfig.MODERATION_POLICY_VERSION,modelVersion:testModerationConfig.MODERATION_MODEL_VERSION});
        };
        await moderateInput('fixture','qualification-expiry-regression',testModerationConfig);
        qualified=false;await assert.rejects(moderateInput('fixture','qualification-expiry-regression',testModerationConfig));
        assert.equal(calls,2);
    }finally{globalThis.fetch=original;}
});
