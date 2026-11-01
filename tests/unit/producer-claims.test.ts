import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialPermit} from '../../src/ai/official-producer';
import {ProducerClaims,producerClaimResponse} from '../../src/security/producer-claims';
import worker,{ServiceDurableObject} from '../../src/server/cloudflare/worker';
import {testModerationConfig} from '../support/moderation-fixture';
const secret='isolated-producer-claim-fixture-secret-at-least-32';
const enabled={...testModerationConfig,AI_PROVIDER:'wan22-official',WAN_PRODUCER_SECRET:secret};
test('durable claim survives recreation without storing a raw permit, image, subject or credential',async()=>{
    const data=new Map<string,unknown>(),storage={get:async<T>(k:string)=>structuredClone(data.get(k)) as T|undefined,put:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}};
    const permit=await officialPermit(secret,'account-a',new Uint8Array([1,2]),'The ball bounces.',1);
    const a=new ProducerClaims(storage,secret);await a.claim(permit);
    await assert.rejects(new ProducerClaims(storage,secret).claim(permit));
    assert.doesNotMatch(JSON.stringify([...data]),/account-a|The ball|Bearer|modelRevision/);
    const invalid=await officialPermit(secret,'account-a',new Uint8Array([1]),'benign',1,Date.now()-600_000);
    await assert.rejects(a.claim(invalid));await assert.rejects(a.claim(permit+'x'));
});
test('claim HTTP boundary rejects blocked inference, malformed signatures, unsupported methods and duplicate work',async()=>{
    let calls=0;const permit=await officialPermit(secret,'account-a',new Uint8Array([1]),'benign',1);
    const request=(body:unknown,method='POST')=>new Request('https://game.test/api/producer/claim',{method,...(method==='POST'?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
    assert.equal((await producerClaimResponse(request({permit}),{...enabled,AI_GENERATION_RELEASE:'blocked'},async()=>{calls++;})).status,503);assert.equal(calls,0);
    assert.equal((await producerClaimResponse(request({permit:'invalid'}),enabled,async()=>{calls++;})).status,503);assert.equal(calls,0);
    assert.equal((await producerClaimResponse(request({},'GET'),enabled,async()=>{})).status,405);
    assert.equal((await producerClaimResponse(request({permit}),enabled,async()=>{calls++;})).status,201);assert.equal(calls,1);
});
test('actual Worker and recreated Services DO maintain the persistent producer fence; blocked release never claims',async()=>{
    const data=new Map<string,unknown>();const storage={get:async<T>(k:string)=>structuredClone(data.get(k)) as T|undefined,put:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}};
    const permit=await officialPermit(secret,'account-a',new Uint8Array([1]),'benign',1);
    const request=()=>new Request('https://internal/security/producer/claim',{method:'POST',body:JSON.stringify({permit})});
    const one=new ServiceDurableObject({storage} as never,enabled as never);
    assert.equal((await one.fetch(request())).status,200);
    const two=new ServiceDurableObject({storage} as never,enabled as never);assert.equal((await two.fetch(request())).status,503);
    const response=await worker.fetch(new Request('https://game.test/api/producer/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({permit})}),{...enabled,AI_GENERATION_RELEASE:'blocked'} as never);
    assert.equal(response.status,503);
});
