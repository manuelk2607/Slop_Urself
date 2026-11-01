import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {officialPermit,OFFICIAL_WAN_MODEL,requireOfficialRecipe} from '../../src/ai/official-producer';
import {providerGpuSeconds,providerSteps,qualityConfig,parseProviderChain} from '../../src/ai/providers';
import {buildProviderValues,generateAiVideo} from '../../src/ai/generation';
import {testImage} from '../support/images';
import {testModerationConfig,moderationFixture} from '../support/moderation-fixture';
test('official provider is explicit, has a different recipe and cannot inherit old economy/fallback modes',()=>{
    const config={AI_PROVIDER_CHAIN:'wan22-official'};
    assert.equal(providerSteps('wan22-official'),50);assert.equal(providerGpuSeconds('wan22-official',config),120);
    assert.equal(providerGpuSeconds('wan22-official',{...config,LTX_DURATION:'8'}),Infinity);
    assert.deepEqual(parseProviderChain('wan22-official'),['wan22-official']);
    for(const q of ['auto','quality','economy'] as const)assert.equal(qualityConfig(config,q).AI_PROVIDER_CHAIN,'wan22-official');
    const lock=JSON.parse(readFileSync('wan-service/official-model-lock.json','utf8'));
    assert.deepEqual(OFFICIAL_WAN_MODEL,{id:lock.id,revision:lock.revision});
    assert.throws(()=>requireOfficialRecipe({}));
    assert.throws(()=>requireOfficialRecipe({WAN_MODEL_ID:lock.id,WAN_MODEL_REVISION:'main',WAN_PRODUCER_SECRET:'a'.repeat(32)}));
    const values=buildProviderValues('wan22-official','The ball bounces.',null,config);
    assert.deepEqual(Object.keys(values),['input_image','prompt','seed','steps','duration_seconds','permit']);
    assert.equal(values.steps,50);assert.equal(values.duration_seconds,5);
});
test('actual Worker-compatible permit verifies in Python and is bound to personal identity and exact input',async()=>{
    const key='isolated-cross-runtime-fixture-secret-at-least-32',image=new Uint8Array([1,2,3]);
    const token=await officialPermit(key,'account-a',image,'The ball bounces.',12);
    // Credentials are synthetic. No network, model loading or GPU invocation.
    const result=execFileSync('python3',['-c',`import sys,json,hashlib;sys.path.insert(0,'wan-service');from jobs import validate_permit;d=json.loads(sys.stdin.read());print(validate_permit(d['token'],d['secret'],'account-a',hashlib.sha256(bytes([1,2,3])).hexdigest(),'The ball bounces.',12))`],{input:JSON.stringify({token,secret:key}),encoding:'utf8'}).trim();
    assert.match(result,/^[a-f0-9-]{36}$/);
    const payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());assert.equal(payload.subject,'account-a');assert.equal(payload.steps,50);
    await assert.rejects(officialPermit('short','account-a',image,'benign',12));
    assert.notEqual(token,await officialPermit(key,'account-b',image,'The ball bounces.',12));
});
test('official recipe refuses a mixed chain before quota, upload or a generation request',async()=>{
    const original=globalThis.fetch;let external=0;
    globalThis.fetch=async(input,init)=>{const fixture=moderationFixture(input,init);if(fixture)return fixture;external++;throw new Error('No external calls permitted');};
    try{
        await assert.rejects(generateAiVideo(`data:image/png;base64,${testImage(640,640).toString('base64')}`,'The ball bounces.',{
            ...testModerationConfig,AI_PROVIDER:'wan22-official',AI_PROVIDER_CHAIN:'wan22-official,wan22',WAN_SPACE_ID:'fixture/official',WAN_SPACE_REVISION:'a'.repeat(40),
            WAN_MODEL_ID:OFFICIAL_WAN_MODEL.id,WAN_MODEL_REVISION:OFFICIAL_WAN_MODEL.revision,WAN_PRODUCER_SECRET:'a'.repeat(32),HF_TOKEN:'fixture-personal-token'}));
        assert.equal(external,0);
    }finally{globalThis.fetch=original;}
});
