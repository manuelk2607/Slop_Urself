import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
import { testModerationConfig } from '../support/moderation-fixture';

// Exercise real fetch modes and bounded bodies inside workerd, not a Node fetch
// stub. This worker is a test-only in-memory bundle, never a published endpoint.
const contents = `
import { fetchGpuQuota } from './src/ai/quota';
import { PlayerQuotaBudget } from './src/ai/player-quota';
import { moderateInput } from './src/security/moderation';
const config = ${JSON.stringify(testModerationConfig)};
const owner = {id:'player-a',accountId:'profile-a',hfConnectionId:'connection-a',subject:'subject-a'};
const data = new Map([['quota-plan:ROOM', {owners:[owner],jobs:{job:'player-a'},members:['player-a'],expiresAt:Date.now()+10000}]]);
const budget = new PlayerQuotaBudget({get:async key=>data.get(key),put:async(key,v)=>data.set(key,v)}, {},
    {jobCredential:async()=>({accountId:'profile-a',subject:'subject-a',token:'personal-fixture'})});
export default { async fetch(request) {
    try {
        const path = new URL(request.url).pathname;
        if(path==='/quota') await fetchGpuQuota({HF_TOKEN:'personal-fixture'});
        else if(path==='/owner') await budget.tokenForJob('ROOM','job');
        else if(path.startsWith('/moderation/')) await moderateInput('synthetic-frame',path,config);
        else return new Response(null,{status:404});
        return Response.json({ok:true});
    } catch {return Response.json({ok:false},{status:409});}
} };`;
const bundle = await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'boundary-runtime.ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser' });
let mode: 'allow' | 'redirect' | 'oversize' | 'foreign' = 'allow';
const calls: string[] = [];
const runtime = new Miniflare({ logRequests: false, telemetry: { enabled: false }, workers: [{ config: {
    name: 'hf-boundary-test', compatibilityDate: '2026-10-03',
    manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } }
}, dev: { outboundService: { type: 'fetcher', handler: async request => {
    const url = new URL(request.url); calls.push(url.origin + url.pathname);
    assert.ok(['huggingface.co', 'moderation.test'].includes(url.hostname), 'Never follow the redirect target');
    assert.equal(request.headers.get('authorization'), `Bearer ${url.hostname === 'huggingface.co' ? 'personal-fixture' : testModerationConfig.MODERATION_SECRET}`);
    if (mode === 'redirect') return new Response(null, { status: 307, headers: { location: 'https://foreign.invalid/credential-trap' } });
    if (mode === 'oversize') return Response.json({ padding: 'x'.repeat(40_000) });
    if (url.hostname === 'moderation.test') return Response.json({ decision: 'allow', digest: request.headers.get('x-content-sha256'),
        policyVersion: testModerationConfig.MODERATION_POLICY_VERSION, modelVersion: testModerationConfig.MODERATION_MODEL_VERSION, decodeComplete: true });
    assert.equal(request.method, 'GET', 'No HF inference/mutation is permitted.');
    if (url.pathname === '/api/whoami-v2') return Response.json({ id: mode === 'foreign' ? 'subject-b' : 'subject-a' });
    assert.equal(url.pathname, '/api/spaces/zero-gpu/quota');
    return Response.json({ base: 300, current: 300, resetsAt: null, runs: { remaining: 8 } });
} } } }] });
try {
    for (const value of ['allow', 'redirect', 'oversize'] as const) {
        mode = value;
        for (const path of ['/quota', '/owner', `/moderation/${mode}`]) {
            const before = calls.length;
            const response = await runtime.dispatchFetch('http://localhost' + path);
            assert.equal(response.status, mode === 'allow' ? 200 : 409, `${mode}: ${path}`);
            assert.equal(calls.length - before, 1, 'One exact upstream request; no redirect or blind retry.');
        }
    }
    mode = 'foreign'; assert.equal((await runtime.dispatchFetch('http://localhost/owner')).status, 409);
    console.log('PASS: workerd personal job identity, quota and moderation fetches reject redirects/oversize bodies/foreign subjects; all outbound services simulated, zero GPU calls.');
} finally { await runtime.dispose(); }
