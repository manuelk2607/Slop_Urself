import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
import { buildVideoPrompt } from '../../src/shared/video-prompt';
import { VALIDATION_PRODUCER_REVISION } from '../../src/security/live-validation';

const accountA = crypto.randomUUID(), accountB = crypto.randomUUID(), jobA = crypto.randomUUID(), jobB = crypto.randomUUID();
const campaign = { id: crypto.randomUUID(), room: 'TEST', approvedAt: Date.now(), expiresAt: Date.now() + 3600_000,
    operatorApproval: 'fixed-pair-approved-2026-11-02', members: [{ accountId: accountA, subject: 'fixture-a' }, { accountId: accountB, subject: 'fixture-b' }],
    moderatorUrl: 'https://isolated-fixture.trycloudflare.com/jobs/validate', moderatorVersion: 'a'.repeat(64) };
const images = await Promise.all(['ball', 'cube'].map(async name => `data:image/png;base64,${(await readFile(`tests/fixtures/live-validation/${name}.png`)).toString('base64')}`));
const secret = 'workerd-only-live-validation-fixture-key-at-least-32';
const contents = `
import worker, {ServiceDurableObject} from './src/server/cloudflare/worker';
import {generateAiVideo} from './src/ai/generation';
import {validationConfig,ValidationLedger,parseValidationCampaign,VALIDATION_PAIR,digest} from './src/security/live-validation';
import {buildVideoPrompt} from './src/shared/video-prompt';
const images=${JSON.stringify(images)}, jobs=${JSON.stringify([jobA, jobB])};
export class TestServices extends ServiceDurableObject {
 constructor(state,env){super(state,env);this.testState=state;this.testEnv=env;}
 async fetch(request){
  if(new URL(request.url).pathname==='/seed'){
   const c=parseValidationCampaign(this.testEnv.LIVE_VALIDATION_CAMPAIGN),ledger=new ValidationLedger(this.testState.storage,c);
   for(let i=0;i<2;i++)await ledger.admit({jobId:jobs[i],...c.members[i],pixelSha256:VALIDATION_PAIR[i].pixelSha256,
     imageSha256:await digest(Uint8Array.from(atob(images[i].split(',')[1]),x=>x.charCodeAt(0))),promptSha256:await digest(buildVideoPrompt(VALIDATION_PAIR[i].prompt)),seed:i+1});
   return Response.json({seeded:true});
  }
  return super.fetch(request);
 }
}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/seed')return env.SERVICES.get(env.SERVICES.idFromName('global')).fetch(new Request('https://internal/seed'));
 if(path.startsWith('/run/')){
  const index=path.endsWith('b')?1:0,c=parseValidationCampaign(env.LIVE_VALIDATION_CAMPAIGN);
  const config={...validationConfig(env,c.room,{id:jobs[index],accountId:c.members[index].accountId}),HF_TOKEN:'personal-fixture-'+(index?'b':'a')};
  try{return Response.json({url:await generateAiVideo(images[index],VALIDATION_PAIR[index].prompt,config,()=>{},async()=>{}, {resultTimeoutMs:1000})});}
  catch{return Response.json({rejected:true},{status:409});}
 }
 return worker.fetch(request,env);
}};`;
const bundle = await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'live-validation-runtime.ts' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const binding = { AI_PROVIDER: 'wan22', AI_GENERATION_RELEASE: 'blocked', LIVE_VALIDATION_CAMPAIGN: JSON.stringify(campaign),
    MODERATION_SECRET: secret, WAN_PRODUCER_SECRET: secret, AUTH_COOKIE_SECRET: secret };
let runtime: Miniflare;
let mode: 'normal' | 'evaluation' | 'drift' | 'index-lag' = 'evaluation';
const allocations: string[] = [], joins: string[] = [];
runtime = new Miniflare({ logRequests: false, telemetry: { enabled: false }, workers: [{ config: {
    name: 'bounded-generation-test', compatibilityDate: '2026-10-03', manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
    exports: { TestServices: { type: 'durable-object', storage: 'sqlite' } },
    env: { ...Object.fromEntries(Object.entries(binding).map(([k, value]) => [k, { type: 'text' as const, value }])), SERVICES: { type: 'durable-object', worker: 'bounded-generation-test', exportName: 'TestServices' } }
}, dev: { outboundService: { type: 'fetcher', handler: async request => {
    const url = new URL(request.url), authorization = request.headers.get('authorization');
    if (url.hostname === 'isolated-fixture.trycloudflare.com') {
        assert.equal(authorization, `Bearer ${secret}`); assert.equal(request.headers.get('x-live-validation'), campaign.id);
        return Response.json({ decision: 'allow', decodeComplete: true, digest: request.headers.get('x-content-sha256'), modelVersion: campaign.moderatorVersion,
            policyVersion: 'slop-content-2026-10-25-v1', validationScope: campaign.id, ...(mode === 'evaluation' ? { evaluationOnly: true } : {}) });
    }
    assert.ok(['huggingface.co', 'manuel2607-slopurself-wan22-validated.hf.space'].includes(url.hostname));
    assert.ok(authorization === 'Bearer personal-fixture-a' || authorization === 'Bearer personal-fixture-b');
    const subject = authorization!.endsWith('-a') ? 'fixture-a' : 'fixture-b';
    if (url.pathname === '/api/whoami-v2') return Response.json({ id: subject });
    if (url.pathname === '/api/spaces/zero-gpu/quota') return Response.json({ base: 300, current: 300, resetsAt: null });
    if (url.pathname.endsWith('/refs')) return Response.json({ branches: [{ name: 'main', ref: 'refs/heads/main', targetCommit: mode === 'drift' ? 'b'.repeat(40) : VALIDATION_PRODUCER_REVISION }] });
    if (url.hostname === 'huggingface.co') return Response.json({ host: 'https://manuel2607-slopurself-wan22-validated.hf.space', sha: ['drift','index-lag'].includes(mode) ? 'b'.repeat(40) : VALIDATION_PRODUCER_REVISION, runtime: { sha: VALIDATION_PRODUCER_REVISION } });
    if (url.pathname === '/gradio_api/info') return Response.json({ named_endpoints: { '/generate_video': { parameters: ['input_image', 'prompt', 'seed', 'steps', 'duration_seconds', 'permit'].map(parameter_name => ({ parameter_name, type: {} })) } } });
    if (url.pathname === '/config') return Response.json({ dependencies: [{ id: 0, api_name: 'generate_video' }], slop_model: { id: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers', revision: 'b8fff7315c768468a5333511427288870b2e9635' } });
    if (url.pathname === '/gradio_api/upload') return Response.json(['/tmp/fixture/input.png']);
    if (url.pathname === '/gradio_api/queue/join') {
        const body = await request.json() as { data: unknown[] }; joins.push(subject);
        assert.equal(body.data[1], buildVideoPrompt(subject === 'fixture-a' ? 'The yellow ball bounces gently in place. Static camera.' : 'The red cube slowly rotates in place. Static camera.'));
        assert.equal(body.data[2], subject === 'fixture-a' ? 1 : 2); assert.equal(body.data[3], 50); assert.equal(body.data[4], 5);
        const claim = await runtime.dispatchFetch('https://game.test/api/producer/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permit: body.data[5] }) });
        if (claim.status !== 201) return Response.json({}, { status: 503 });
        allocations.push(subject); return Response.json({ event_id: 'fixture-event' });
    }
    if (url.pathname === '/gradio_api/queue/data') return new Response('data: ' + JSON.stringify({ msg: 'process_completed', event_id: 'fixture-event', success: true, output: { data: [{ url: 'https://manuel2607-slopurself-wan22-validated.hf.space/private-videos/fixture.mp4' }] } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    throw Error('Unexpected simulated outbound path');
} } } }] });
try {
    assert.equal((await runtime.dispatchFetch('https://game.test/seed')).status, 200);
    assert.equal((await runtime.dispatchFetch('https://game.test/run/a')).status, 409); assert.equal(joins.length, 0);
    mode = 'drift'; assert.equal((await runtime.dispatchFetch('https://game.test/run/a')).status, 409); assert.equal(joins.length, 0);
    mode = 'normal'; assert.equal((await runtime.dispatchFetch('https://game.test/run/a')).status, 200);
    mode = 'index-lag'; assert.equal((await runtime.dispatchFetch('https://game.test/run/b')).status, 200);
    assert.deepEqual(allocations, ['fixture-a', 'fixture-b']);
    assert.equal((await runtime.dispatchFetch('https://game.test/run/a')).status, 409);
    assert.deepEqual(allocations, ['fixture-a', 'fixture-b'], 'A replay can never allocate again, even with a newly signed permit');
    const config = await (await runtime.dispatchFetch('https://game.test/api/config')).json() as { generationBlocked: boolean };
    assert.equal(config.generationBlocked, true);
    console.info('PASS: real workerd bounded generation flow binds two personal credentials, exact inputs, 50-step model pins and durable claims; evaluation/drift/replay rejected; all providers simulated, zero GPU calls.');
} finally { await runtime.dispose(); }
