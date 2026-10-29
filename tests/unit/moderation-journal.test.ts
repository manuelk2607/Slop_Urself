import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoredModerationJournal } from '../../src/security/moderation-journal';
import { moderateOutput, generationSafetyReady } from '../../src/security/moderation';
import { moderationRequest } from '../../src/security/moderation-jobs';
import { testModerationConfig } from '../support/moderation-fixture';

function storage() {
    const data = new Map<string, unknown>();
    return { data, get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
        put: async <T>(key: string, value: T) => { data.set(key, structuredClone(value)); } };
}
const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
test('output tickets survive service eviction and pending returns without occupying the archive queue', async () => {
    const state = storage(), original = globalThis.fetch; let posts = 0, gets = 0, complete = false, digest = '';
    const config = { ...testModerationConfig, MODERATION_URL: 'https://moderation.test/jobs/validate', AI_PROVIDER: 'wan22' };
    try {
        globalThis.fetch = async (url, options) => {
            digest = new Headers(options?.headers).get('x-content-sha256')!;
            if (options?.method === 'POST') { posts++; return Response.json({ id, digest, status: 'pending' }, { status: 202 }); }
            gets++; assert.equal(String(url), 'https://moderation.test/jobs/' + id);
            return complete ? Response.json({ ...config, decision: 'allow', digest, policyVersion: config.MODERATION_POLICY_VERSION,
                modelVersion: config.MODERATION_MODEL_VERSION, decodeComplete: true, frameCount: 81, framesChecked: 81, durationSeconds: 5, codec: 'h264', pixelFormat: 'yuv420p' })
                : Response.json({ digest, status: 'pending' }, { status: 202 });
        };
        const check = () => moderateOutput(new Uint8Array([1, 2, 3]), { ...config, moderationJournal: new StoredModerationJournal(state) });
        await assert.rejects(check(), /Inhaltsprüfung/); assert.equal(posts, 1); assert.equal(gets, 0);
        await assert.rejects(check()); assert.equal(posts, 1); assert.equal(gets, 1);
        const saved = JSON.stringify([...state.data]);
        assert.ok(saved.includes(id)); assert.ok(!saved.includes(config.MODERATION_SECRET)); assert.ok(!saved.includes('https:'));
        complete = true; await check(); assert.equal(posts, 1); assert.equal(gets, 2);
        assert.deepEqual(state.data.get('moderation-checkpoints'), {});
        await assert.rejects(check()); assert.equal(posts, 2, 'completed verdicts are not cached across qualification checks');
    } finally { globalThis.fetch = original; }
});

test('persisted uncertain intent recovers by digest after a lost reply, never another POST', async () => {
    const state = storage(), original = globalThis.fetch, digest = 'd'.repeat(64), key = 'e'.repeat(64); let posts = 0, lookup = 0;
    try {
        globalThis.fetch = async (url, options) => {
            if (options?.method === 'POST') { posts++; throw new Error('Lost after remote commit'); }
            lookup++; assert.equal(String(url), 'https://moderation.test/jobs/lookup');
            if (lookup === 1) throw new Error('Temporary outage');
            return Response.json({ id, digest, status: 'pending' }, { status: 202 });
        };
        const check = () => moderationRequest('https://moderation.test/jobs/validate', 'fixture', '{}', digest, undefined,
            { key, journal: new StoredModerationJournal(state) });
        await assert.rejects(check()); await assert.rejects(check());
        assert.equal(posts, 1); assert.equal(lookup, 2);
        assert.equal((await new StoredModerationJournal(state).load(key))?.id, id);
    } finally { globalThis.fetch = original; }
});

test('journal rejects invalid/capacity entries and removes expired data without storing approvals', async () => {
    const state = storage(), journal = new StoredModerationJournal(state), digest = 'd'.repeat(64);
    await assert.rejects(journal.save('../secret', { digest, expiresAt: Date.now() + 5000 }));
    await assert.rejects(journal.save('e'.repeat(64), { digest, id: 'https://evil.test', expiresAt: Date.now() + 5000 }));
    for (let n = 0; n < 64; n++) await journal.save(n.toString(16).padStart(64, '0'), { digest, expiresAt: Date.now() + 5000 });
    await assert.rejects(journal.save('f'.repeat(64), { digest, expiresAt: Date.now() + 5000 }));
    state.data.set('moderation-checkpoints', { expired: { digest, expiresAt: Date.now() - 1 } });
    await journal.cleanup(); assert.deepEqual(state.data.get('moderation-checkpoints'), {});
});

test('explicit production release block wins even over a configured moderation service', () => {
    assert.throws(() => generationSafetyReady({ ...testModerationConfig, AI_PROVIDER: 'wan22', AI_GENERATION_RELEASE: 'blocked' }));
    generationSafetyReady({ AI_PROVIDER: 'mock', AI_GENERATION_RELEASE: 'blocked' });
});
