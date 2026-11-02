import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import dotenv from 'dotenv';
import { parseValidationCampaign, VALIDATION_PRODUCER_REVISION } from '../src/security/live-validation.js';
import { gitMainRevision } from '../src/ai/provider-trust.js';
if (!process.argv.includes('--activate-approved-two-video-window')) throw Error('Explicit bounded free validation approval required');
const flag = process.argv.indexOf('--campaign'), file = resolve(process.argv[flag + 1] || '');
if (flag < 0 || !file.startsWith(resolve('.local/live-validation') + '/') || !file.endsWith('/campaign.json')) throw Error('Expected the reviewed local campaign file');
const campaign = parseValidationCampaign(await readFile(file, 'utf8')); if (!campaign) throw Error('Invalid/expired exact-pair campaign');
const env = dotenv.parse(await readFile('.env.local')); if (!env.HF_DEPLOY_TOKEN) throw Error('Local scoped deployment credential required');
const repo = 'Manuel2607/SlopUrself-Wan22-Validated';
async function api(path: string, init: RequestInit = {}) {
    const r = await fetch(`https://huggingface.co/api/spaces/${repo}${path}`, { ...init, redirect: 'error', headers: { authorization: `Bearer ${env.HF_DEPLOY_TOKEN}`, ...init.headers }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) { await r.body?.cancel(); throw Error(`Activation HTTP ${r.status}; inspect status, no automatic retry`); } return r;
}
const meta = await (await api('')).json() as { private?: boolean; sha?: string; runtime?: { sha?: string; stage?: string; hardware?: { current?: string; requested?: string } } };
const main = gitMainRevision(await (await api('/refs')).json());
if (meta.private !== false || main !== VALIDATION_PRODUCER_REVISION || meta.runtime?.sha !== main || meta.runtime.stage !== 'RUNNING'
    || meta.runtime.hardware?.current !== 'zero-a10g' || meta.runtime.hardware.requested !== 'zero-a10g') throw Error('Exact reviewed free public runtime required');
const health = await fetch('https://manuel2607-slopurself-wan22-validated.hf.space/healthz', { redirect: 'error', signal: AbortSignal.timeout(15_000) });
if (!health.ok) throw Error('Producer readiness unavailable');
const h = await health.json() as { modelLoaded?: boolean; preparationOnly?: boolean; generationAvailable?: boolean };
if (!h.modelLoaded || !h.preparationOnly || h.generationAvailable) throw Error('Expected the initialized preparation-only producer; inspect any prior activation');
const config = await fetch('https://slopurself.maki26.workers.dev/api/config', { redirect: 'error', signal: AbortSignal.timeout(15_000) });
if (!config.ok || (await config.json() as { generationBlocked?: boolean }).generationBlocked !== true) throw Error('Global game release must remain blocked');
// A local exclusive receipt also stops an interrupted command being blindly
// repeated. Inspect HF flags/runtime and this receipt after an uncertain result.
const receipt = resolve(dirname(file), 'activation.json');
await writeFile(receipt, JSON.stringify({ campaign: campaign.id, revision: main, requestedAt: Date.now(), acknowledged: false, gpuRequests: 0 }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
for (const [key, value] of Object.entries({ WAN_VALIDATION_CAMPAIGN_ID: campaign.id, WAN_VALIDATION_EXPIRES_AT: String(Math.floor(campaign.expiresAt / 1000)), WAN_PREPARATION_ONLY: 'no' })) {
    await (await api('/variables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) })).body?.cancel();
}
await writeFile(receipt, JSON.stringify({ campaign: campaign.id, revision: main, acknowledged: true, expiresAt: campaign.expiresAt, gpuRequests: 0, next: 'Verify exact runtime readiness and both live quotas before one actual game upload per account.' }, null, 2) + '\n', { mode: 0o600 });
console.info(JSON.stringify({ acknowledged: true, campaign: campaign.id, freeHardware: 'zero-a10g', maximumVideos: 2, maximumSecondsPerAccount: 120, gpuRequests: 0 }));
