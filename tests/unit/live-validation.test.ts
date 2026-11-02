import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { VALIDATION_PAIR, parseValidationCampaign, validationConfig, validationScope, validationInput, ValidationLedger, digest, type ValidationCampaign } from '../../src/security/live-validation';
import { VALIDATION_PRODUCER_REVISION } from '../../src/security/live-validation';
import { HfConnections } from '../../src/auth/huggingface';
import { ArchiveReservations } from '../../src/storage/reservations';
import { archiveVideo } from '../../src/storage/archive';
import { generationSafetyReady, blockedGenerationCapacity } from '../../src/security/moderation';
import { officialPermit } from '../../src/ai/official-producer';
import { verifyProducerPermit, producerClaimResponse } from '../../src/security/producer-claims';
import worker, { ServiceDurableObject } from '../../src/server/cloudflare/worker';
import { buildVideoPrompt } from '../../src/shared/video-prompt';
const secret = 'isolated-validation-fixture-secret-only-at-least-32';
const campaign = (): ValidationCampaign => ({ id: crypto.randomUUID(), room: 'TEST', approvedAt: Date.now(), expiresAt: Date.now() + 3600_000,
    operatorApproval: 'fixed-pair-approved-2026-11-02', moderatorUrl: 'https://isolated-fixture.trycloudflare.com/jobs/validate', moderatorVersion: 'a'.repeat(64),
    members: [{ accountId: crypto.randomUUID(), subject: 'fixture-a' }, { accountId: crypto.randomUUID(), subject: 'fixture-b' }] });
const env = (c: ValidationCampaign) => ({ AI_PROVIDER: 'wan22', AI_GENERATION_RELEASE: 'blocked', LIVE_VALIDATION_CAMPAIGN: JSON.stringify(c), MODERATION_SECRET: secret, WAN_PRODUCER_SECRET: secret });
const store = () => { const data = new Map<string, unknown>(); return { data, get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined, put: async (k: string, v: unknown) => { data.set(k, structuredClone(v)); } }; };
test('only the exact server-configured room receives an expiring branded scope; the public release stays blocked', () => {
    const c = campaign(), base = env(c), scoped = validationConfig(base, 'TEST');
    assert.equal(scoped.AI_GENERATION_RELEASE, 'blocked'); assert.ok(validationScope(scoped));
    assert.doesNotThrow(() => generationSafetyReady(scoped));
    assert.throws(() => generationSafetyReady(base));
    assert.throws(() => generationSafetyReady({ ...base, liveValidation: { campaign: c } }));
    assert.equal(validationConfig(base, 'NOPE'), base);
    assert.equal(blockedGenerationCapacity(base, 2)?.aiRoundLimit, 0);
    assert.equal(validationScope(scoped, c.expiresAt), undefined);
    for (const change of [{ members: [c.members[0], c.members[0]] }, { expiresAt: Date.now() - 1 }, { expiresAt: c.approvedAt + 7 * 3600_000 },
        { operatorApproval: 'not-reviewed' }, { moderatorUrl: 'https://evil.test/jobs/validate' }, { moderatorUrl: c.moderatorUrl + '?token=bad' }])
        assert.equal(parseValidationCampaign(JSON.stringify({ ...c, ...change })), undefined);
});
test('the exact decoded synthetic pixels, submitted prompt and profile are independently bound', async () => {
    const c = campaign(), config = validationConfig(env(c), c.room);
    const a = `data:image/png;base64,${(await readFile('tests/fixtures/live-validation/ball.png')).toString('base64')}`;
    const b = `data:image/png;base64,${(await readFile('tests/fixtures/live-validation/cube.png')).toString('base64')}`;
    assert.equal((await validationInput(config, c.members[0].accountId, a, VALIDATION_PAIR[0].prompt))?.seed, 1);
    await assert.rejects(validationInput(config, c.members[0].accountId, b, VALIDATION_PAIR[0].prompt));
    await assert.rejects(validationInput(config, c.members[1].accountId, a, VALIDATION_PAIR[0].prompt));
    await assert.rejects(validationInput(config, c.members[0].accountId, a, 'A different animation.'));
    await assert.rejects(validationInput(config, crypto.randomUUID(), a, VALIDATION_PAIR[0].prompt));
    const pixels = await sharp(await readFile('tests/fixtures/live-validation/ball.png')).ensureAlpha().raw().toBuffer();
    const reshaped = await sharp(pixels, { raw: { width: 512, height: 800, channels: 4 } }).png().toBuffer();
    await assert.rejects(validationInput(config, c.members[0].accountId, `data:image/png;base64,${reshaped.toString('base64')}`, VALIDATION_PAIR[0].prompt));
});
test('the permanent two-slot fence survives recreation, permit expiry and a new job UUID', async () => {
    const c = campaign(), storage = store(), ledger = new ValidationLedger(storage, c);
    const value = { jobId: crypto.randomUUID(), ...c.members[0], pixelSha256: VALIDATION_PAIR[0].pixelSha256,
        imageSha256: 'b'.repeat(64), promptSha256: await digest(buildVideoPrompt(VALIDATION_PAIR[0].prompt)), seed: 1 };
    await ledger.admit(value); await ledger.admit(value);
    await assert.rejects(ledger.admit({ ...value, jobId: crypto.randomUUID() }));
    await assert.rejects(ledger.admit({ ...value, subject: c.members[1].subject }));
    await assert.rejects(ledger.admit({ ...value, pixelSha256: 'f'.repeat(64) }));
    const rotated: ValidationCampaign = { ...c, members: [{ ...c.members[0], accountId: crypto.randomUUID() }, c.members[1]] };
    await assert.rejects(new ValidationLedger(storage, rotated).admit({ ...value, accountId: rotated.members[0].accountId, jobId: crypto.randomUUID() }));
    const claim = { id: value.jobId, subject: value.subject, imageSha256: value.imageSha256, promptSha256: value.promptSha256, seed: value.seed };
    await assert.rejects(ledger.claim({ ...claim, imageSha256: 'c'.repeat(64) }));
    await ledger.claim(claim);
    await assert.rejects(new ValidationLedger(storage, c).claim(claim));
    assert.equal((await ledger.context(value.jobId)).claimed, true);
    assert.doesNotMatch(JSON.stringify([...storage.data]), /Bearer|base64|yellow|hf_/);
});
test('real HTTP/Services claims require durable admission and personal scope; public config remains blocked', async () => {
    const c = campaign(), base = env(c), storage = store(), id = crypto.randomUUID(), bytes = new Uint8Array([1, 2]);
    const prompt = buildVideoPrompt(VALIDATION_PAIR[0].prompt);
    const token = await officialPermit(secret, c.members[0].subject, bytes, prompt, 1, Date.now(), id);
    const permit = await verifyProducerPermit(token, secret);
    const request = () => new Request('https://game.test/api/producer/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permit: token }) });
    const service = new ServiceDurableObject({ storage } as never, base as never);
    const claim = async (permit: string) => { const r = await service.fetch(new Request('https://internal/security/producer/claim', { method: 'POST', body: JSON.stringify({ permit }) })); if (!r.ok) throw Error('rejected'); };
    assert.equal((await producerClaimResponse(request(), base, claim, true)).status, 503);
    await new ValidationLedger(storage, c).admit({ jobId: id, ...c.members[0], pixelSha256: VALIDATION_PAIR[0].pixelSha256,
        imageSha256: await digest(bytes), promptSha256: await digest(prompt), seed: 1 });
    assert.equal((await producerClaimResponse(request(), base, claim)).status, 503, 'Node/default callers must not gain campaign claims');
    assert.equal((await producerClaimResponse(request(), base, claim, true)).status, 201);
    assert.equal((await producerClaimResponse(request(), base, claim, true)).status, 503);
    assert.equal(permit.id, id);
    const r = await worker.fetch(new Request('https://game.test/api/config'), { ...base, SERVICES: {
        idFromName: () => ({}), get: () => ({ fetch: async () => Response.json({ retryAfter: 0 }) })
    } } as never);
    const body = await r.json() as { generationBlocked: boolean; aiRoundLimit: number };
    assert.equal(body.generationBlocked, true); assert.equal(body.aiRoundLimit, 0);
    assert.equal((await worker.fetch(new Request('https://game.test/api/hf/validation'), { ...base, SERVICES: {
        idFromName: () => ({}), get: () => ({ fetch: async () => Response.json({ retryAfter: 0 }) })
    } } as never)).status, 401);
});
test('readiness is read-only and refuses preparation, moderator mismatch and foreign HF ownership before reserving any slot', async t => {
    const c = campaign(), storage = store(), calls: string[] = [];
    const service = new ServiceDurableObject({ storage } as never, { ...env(c), AWS_ACCESS_KEY_ID: 'isolated', AWS_SECRET_ACCESS_KEY: 'isolated', AWS_ENDPOINT_URL_S3: 'https://storage.test' } as never);
    let mode: 'preparation' | 'foreign' | 'moderator' | 'ready' = 'preparation';
    t.mock.method(HfConnections.prototype, 'credential', async (_connection: string, accountId: string) => ({ accountId, subject: mode === 'foreign' ? 'someone-else' : c.members.find(m => m.accountId === accountId)!.subject, token: 'isolated-' + accountId }));
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
        assert.equal(options?.method || 'GET', 'GET'); const url = input instanceof Request ? input.url : String(input); calls.push(url);
        if (url.startsWith('https://storage.test')) return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
        if (url.endsWith('/refs')) return Response.json({ branches: [{ name: 'main', ref: 'refs/heads/main', targetCommit: VALIDATION_PRODUCER_REVISION }] });
        if (url.includes('huggingface.co/api/spaces/')) return Response.json({ host: 'https://manuel2607-slopurself-wan22-validated.hf.space', sha: 'b'.repeat(40), runtime: { sha: VALIDATION_PRODUCER_REVISION } });
        if (url.endsWith('/config')) return Response.json(mode === 'preparation' ? {} : { slop_model: { id: 'Wan-AI/Wan2.2-TI2V-5B-Diffusers', revision: 'b8fff7315c768468a5333511427288870b2e9635' } });
        if (url.endsWith('/health')) return Response.json({ scopedReady: true, validationScope: c.id, modelVersion: mode === 'moderator' ? 'b'.repeat(64) : c.moderatorVersion, qualifiedForGeneralUse: false });
        assert.ok(url.endsWith('/identity')); return Response.json({ personalIdentityVerified: true, proxySubjectMatches: true });
    });
    const request = () => new Request('https://internal/security/validation/ready', { method: 'POST', body: JSON.stringify({ code: c.room, participants: c.members.map((m, i) => ({ id: 'player-' + i, accountId: m.accountId, hfConnectionId: 'connection-' + i })) }) });
    for (const state of ['preparation', 'foreign', 'moderator', 'ready'] as const) {
        mode = state; assert.equal((await service.fetch(request())).status, state === 'ready' ? 200 : state === 'foreign' ? 403 : 503);
        assert.equal(storage.data.size, 0, 'Preflight cannot consume a GPU slot, quota reservation or producer claim');
    }
    assert.ok(calls.every(url => !/queue|schedule|upload/.test(url)));
});
test('bounded live tests never evict or reconcile existing videos even when storage is full', async t => {
    const c = campaign(), storage = store(), jobId = crypto.randomUUID();
    const config = validationConfig({ ...env(c), AWS_ACCESS_KEY_ID: 'isolated', AWS_SECRET_ACCESS_KEY: 'isolated', AWS_ENDPOINT_URL_S3: 'https://storage.test', VIDEO_ARCHIVE_MB: '20' }, c.room, { id: jobId, accountId: c.members[0].accountId });
    const calls: string[] = []; let reconciled = false;
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input), method = options?.method || (input instanceof Request ? input.method : 'GET'); calls.push(method);
        assert.notEqual(method, 'DELETE'); assert.notEqual(method, 'PUT');
        if (url.startsWith('https://storage.test')) return new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>videos/1760000000000-existing.mp4</Key><Size>20971520</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents></ListBucketResult>');
        if (url.includes('.hf.space/')) return new Response(Uint8Array.from([0,0,0,16,102,116,121,112,0,0,0,0,0,0,0,0]));
        const body = String(options?.body); return Response.json({ decision: 'allow', digest: await digest(body), policyVersion: config.MODERATION_POLICY_VERSION, modelVersion: config.MODERATION_MODEL_VERSION,
            validationScope: c.id, decodeComplete: true, frameCount: 121, framesChecked: 121, durationSeconds: 5.04, codec: 'h264', pixelFormat: 'yuv420p' });
    });
    await assert.rejects(new ArchiveReservations(storage).reserve(jobId, c.room, config));
    assert.equal(storage.data.size, 0);
    await assert.rejects(archiveVideo('https://fixture.hf.space/video.mp4', config, [], async () => { reconciled = true; }, c.room));
    assert.equal(reconciled, false); assert.ok(!calls.includes('DELETE') && !calls.includes('PUT'));
});
