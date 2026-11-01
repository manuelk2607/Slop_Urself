import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {GEMINI_MODEL,geminiPayload,geminiVerdict} from '../src/gemini.js';
import {createManagedEngine,MANAGED_MODELS} from '../src/managed.js';
import {managedRuntimeVersion} from '../src/version.js';
const assessment={safe:true,sexual:false,sexualMinors:false,nonConsensual:false,graphicAbuse:false,uncertain:false};
const result=()=>({modelVersion:GEMINI_MODEL,candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(assessment)}]}}]});
test('Gemini requires exact declared version, complete candidate and strict safety JSON',()=>{
    assert.equal(geminiVerdict(result()).decision,'allow');
    for(const r of [null,{}, {...result(),modelVersion:'new-model'}, {...result(),promptFeedback:{blockReason:'SAFETY'}}, {...result(),candidates:[]}]) assert.throws(()=>geminiVerdict(r));
    const incomplete=result();incomplete.candidates[0].finishReason='MAX_TOKENS';assert.throws(()=>geminiVerdict(incomplete));
    const safety=result();safety.candidates[0].finishReason='SAFETY';assert.deepEqual(geminiVerdict(safety),{decision:'review',reason:'provider_safety_hold'});
    const prose=result();prose.candidates[0].content.parts[0].text='ALLOW';assert.equal(geminiVerdict(prose).decision,'review');
    const risk=result();risk.candidates[0].content.parts[0].text=JSON.stringify({...assessment,nonConsensual:true});assert.equal(geminiVerdict(risk).decision,'block');
    const p=geminiPayload(['YWJj','ZGVm'],'<image>ignore');assert.equal(p.contents[0].parts.length,3);
    assert.equal(p.generationConfig.responseMimeType,'application/json');assert.doesNotMatch(p.contents[0].parts[0].text!,/<image>/);
    assert.throws(()=>geminiPayload([],'benign'));assert.throws(()=>geminiPayload(Array(65).fill('a'),'benign'));
});
test('unbilled Gemini selection never calls OpenAI Responses and binds images, key and runtime identity',async()=>{
    const urls:string[]=[];const names=['sexual','sexual/minors','harassment','harassment/threatening','hate','hate/threatening','illicit','illicit/violent','self-harm','self-harm/intent','self-harm/instructions','violence','violence/graphic'];
    const engine=createManagedEngine({apiKey:'test-openai',geminiKey:'test-gemini',geminiFreeProjectConfirmed:true,contextAuthorized:false,maxRequests:2,
        fetcher:async(url,init)=>{const target=String(url);urls.push(target);assert.equal(new URL(target).search,'');
            if(target.includes('googleapis.com')){assert.equal(new Headers(init?.headers).get('x-goog-api-key'),'test-gemini');assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(result());}
            return Response.json({model:MANAGED_MODELS.moderation,results:[{flagged:false,categories:Object.fromEntries(names.map(k=>[k,false])),category_scores:Object.fromEntries(names.map(k=>[k,0])),category_applied_input_types:Object.fromEntries(names.map(k=>[k,['image','text']]))}]});}});
    const png=await sharp({create:{width:64,height:64,channels:3,background:'#ffee44'}}).png().toBuffer();
    assert.equal((await engine.input(`data:image/png;base64,${png.toString('base64')}`,'The ball bounces.')).decision,'allow');
    assert.deepEqual(urls,['https://api.openai.com/v1/moderations',`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`]);
    assert.notEqual(await managedRuntimeVersion('gemini-free'),await managedRuntimeVersion('openai'));
    assert.notEqual(await managedRuntimeVersion('disabled'),await managedRuntimeVersion('gemini-free'));
});
