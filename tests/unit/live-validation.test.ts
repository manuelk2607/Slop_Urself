import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { VALIDATION_PAIR, parseValidationCampaign, validationConfig, validationScope, validationInput, ValidationLedger, digest, type ValidationCampaign } from '../../src/security/live-validation';
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
