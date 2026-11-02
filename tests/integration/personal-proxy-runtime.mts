import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
import { VALIDATION_PRODUCER_REVISION } from '../../src/security/live-validation';

// Real workerd Request/fetch and Services dispatch. All outbound providers are
// fixtures; no live credentials, model inference, production DB or GPU calls.
const accounts = [crypto.randomUUID(), crypto.randomUUID()];
const expiry = Math.floor(Date.now() / 1000) + 240;
const resourceTokens = [0, 1].map(index => `e30.${Buffer.from(JSON.stringify({ exp: expiry, fixtureOwner: index })).toString('base64url')}.Zml4dHVyZQ`);
const campaign = { id: crypto.randomUUID(), room: 'TEST', approvedAt: Date.now(), expiresAt: Date.now() + 3600_000,
    operatorApproval: 'fixed-pair-approved-2026-11-02', members: accounts.map((accountId, i) => ({ accountId, subject: 'fixture-' + i })),
    moderatorUrl: 'https://fixture.trycloudflare.com/jobs/validate', moderatorVersion: 'a'.repeat(64) };
const contents = `
import {ServiceDurableObject} from './src/server/cloudflare/services';
import {HfConnections} from './src/auth/huggingface';
export {ServiceDurableObject};
const members=${JSON.stringify(campaign.members)};
HfConnections.prototype.credential=async function(connection,accountId){const i=members.findIndex(m=>m.accountId===accountId);if(i<0)throw Error('Unexpected fixture identity');return {...members[i],token:'fixture-personal-'+i};};
export default {async fetch(request,env){
 const requestUrl=new URL(request.url),path=requestUrl.pathname;
 if(path==='/construction'){let rejected=false;try{new Request('https://never-called.invalid/',{redirect:'error'});}catch(e){rejected=e instanceof TypeError;}return Response.json({errorModeRejected:rejected,manual:new Request('https://never-called.invalid/',{redirect:'manual'}).redirect});}
 const ready=path==='/ready',i=path.endsWith('/b')?1:0;
 return env.SERVICES.get(env.SERVICES.idFromName('global')).fetch(new Request('https://internal/security/validation/'+(ready?'ready':'identity'),{method:'POST',body:JSON.stringify({code:'TEST',accountId:members[i].accountId,connection:'fixture-'+i,transport:requestUrl.searchParams.get('transport')||'personal',participants:members.map((m,i)=>({id:'p'+i,accountId:m.accountId,hfConnectionId:'fixture-'+i}))})}));
}};`;
const bundle = await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'proxy-runtime.ts' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const values = { AI_PROVIDER: 'wan22', AI_GENERATION_RELEASE: 'blocked', LIVE_VALIDATION_CAMPAIGN: JSON.stringify(campaign),
    MODERATION_SECRET: 'fixture-secret-at-least-thirty-two-characters', WAN_PRODUCER_SECRET: 'fixture-secret-at-least-thirty-two-characters',
    AWS_ACCESS_KEY_ID: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture', AWS_ENDPOINT_URL_S3: 'https://storage.test' };
let mode: 'normal' | 'redirect' | 'unbound' = 'normal';
const requests: string[] = [];
const runtime = new Miniflare({ logRequests: false, telemetry: { enabled: false }, workers: [{ config: {
    name: 'personal-proxy-regression', compatibilityDate: '2026-10-03',
    manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
    exports: { ServiceDurableObject: { type: 'durable-object', storage: 'sqlite' } },
    env: { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { type: 'text' as const, value }])),
        SERVICES: { type: 'durable-object', worker: 'personal-proxy-regression', exportName: 'ServiceDurableObject' } }
}, dev: { outboundService: { type: 'fetcher', handler: async request => {
    const url = new URL(request.url); requests.push(url.origin + url.pathname);
    assert.equal(request.method, 'GET');
    if (url.hostname === 'storage.test') return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
    if (url.hostname === 'huggingface.co' && url.pathname.endsWith('/jwt')) {
        const authorization = request.headers.get('authorization');
        assert.ok(['Bearer fixture-personal-0', 'Bearer fixture-personal-1'].includes(authorization!));
        const token = resourceTokens[authorization!.endsWith('-1') ? 1 : 0];
        assert.equal(url.searchParams.get('expires_in'), '300');
        return Response.json({ token, accessToken: `Bearer ${token}`, exp: expiry });
    }
    if (url.pathname.endsWith('/refs')) return Response.json({ branches: [{ name: 'main', ref: 'refs/heads/main', targetCommit: VALIDATION_PRODUCER_REVISION }] });
    if (url.hostname === 'huggingface.co') return Response.json({ host: 'https://manuel2607-slopurself-wan22-validated.hf.space', sha: VALIDATION_PRODUCER_REVISION, runtime: { sha: VALIDATION_PRODUCER_REVISION } });
    if (url.pathname === '/config') return Response.json({ slop_model: { id: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers', revision: 'b8fff7315c768468a5333511427288870b2e9635' } });
    if (url.hostname === 'fixture.trycloudflare.com') return Response.json({ scopedReady: true, qualifiedForGeneralUse: false, validationScope: campaign.id, modelVersion: campaign.moderatorVersion });
    assert.equal(url.hostname, 'manuel2607-slopurself-wan22-validated.hf.space'); assert.equal(url.pathname, '/identity');
    const authorization = request.headers.get('authorization');
    assert.ok(['Bearer fixture-personal-0', 'Bearer fixture-personal-1'].includes(authorization!));
    const index = authorization!.endsWith('-1') ? 1 : 0;
    assert.ok([authorization, `Bearer ${resourceTokens[index]}`].includes(request.headers.get('x-hf-authorization')!));
    assert.equal(request.headers.get('x-slop-hf-authorization'), authorization);
    if (request.headers.has('cookie')) assert.equal(request.headers.get('cookie'), `__sign=${resourceTokens[index]}`);
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://never-forward.test/collect' } });
    return Response.json({ personalIdentityVerified: true, proxySubjectMatches: mode !== 'unbound', proxyClaimKeys: ['sub'], billingVerified: false, gpuCalls: 0 });
} } } }] });
try {
    assert.deepEqual(await (await runtime.dispatchFetch('https://test/construction')).json(), { errorModeRejected: true, manual: 'manual' });
    assert.equal(requests.length, 0);
    for (const slot of ['a', 'b']) {
        const proof = await (await runtime.dispatchFetch('https://test/proxy/' + slot)).json() as { proxySubjectMatches: boolean; billingVerified: boolean; gpuCalls: number };
        assert.equal(proof.proxySubjectMatches, true, JSON.stringify(proof)); assert.equal(proof.billingVerified, false); assert.equal(proof.gpuCalls, 0);
    }
    for (const transport of ['space-jwt', 'space-cookie']) for (const slot of ['a', 'b']) {
        const result = await (await runtime.dispatchFetch(`https://test/proxy/${slot}?transport=${transport}`)).json() as { proxySubjectMatches: boolean; credentialRoute: string };
        assert.equal(result.proxySubjectMatches, true); assert.equal(result.credentialRoute, transport);
    }
    assert.equal((await runtime.dispatchFetch('https://test/ready')).status, 200);
    mode = 'unbound'; assert.equal((await runtime.dispatchFetch('https://test/ready')).status, 503);
    mode = 'redirect';
    const denied = await (await runtime.dispatchFetch('https://test/proxy/a')).json() as { probeFailed: boolean; phase: string; code: string };
    assert.equal(denied.probeFailed, true); assert.equal(denied.phase, 'producer'); assert.equal(denied.code, 'producer_redirect');
    assert.ok(requests.every(url => !/never-forward|queue|schedule|upload|quota/.test(url)));
    console.info('PASS: actual workerd rejects error redirect mode; manual Services/proxy/readiness calls succeed, preserve two personal credentials and reject redirects/unbound callers without GPU calls. All external providers simulated.');
} finally { await runtime.dispose(); }
