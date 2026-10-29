import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeInputs } from '../../src/server/node-inputs';
import { PendingInputs } from '../../src/security/pending-input';
import { testImageData } from '../support/images';
import { testModerationConfig } from '../support/moderation-fixture';

function fixture() {
    const data = new Map<string, unknown>();
    return { data, get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => data.delete(key) };
}
const config = { ...testModerationConfig, MODERATION_URL: 'https://moderation.test/jobs/validate', AI_PROVIDER: 'wan22' };
const submission = () => ({ id: crypto.randomUUID(), code: 'TEST', creatorId: 'host', accountId: 'account', prompt: 'Safe movement' });
async function waitFor(predicate: () => boolean) {
    const until = Date.now() + 5000;
    while (!predicate()) { if (Date.now() > until) throw new Error('Test deadline'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
test('Node retries the persisted moderation ticket, hands off once and clears private disk state', async () => {
    const original = globalThis.fetch, store = fixture(), inputs = new NodeInputs(store, config, 5);
    let posts = 0, gets = 0, approvals = 0, rejected = 0;
    globalThis.fetch = async (_url, options) => {
        const digest = new Headers(options?.headers).get('x-content-sha256');
        if (options?.method === 'POST') { posts++; return Response.json({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', digest, status: 'pending' }, { status: 202 }); }
        gets++;
        return gets < 2 ? Response.json({ digest, status: 'pending' }, { status: 202 }) : Response.json({ decision: 'allow', digest, decodeComplete: true, policyVersion: config.MODERATION_POLICY_VERSION, modelVersion: config.MODERATION_MODEL_VERSION });
    };
    try {
        await inputs.submit(submission(), testImageData(832, 624), { current: () => true,
            approved: async image => { assert.ok(image.startsWith('data:image/png')); approvals++; }, rejected: async () => { rejected++; } });
        await assert.rejects(inputs.submit(submission(), testImageData(832, 624), { current: () => true, approved: async () => {}, rejected: async () => {} }), /bereits/);
        await waitFor(() => !inputs.has('TEST'));
        assert.equal(posts, 1); assert.equal(gets, 2); assert.equal(approvals, 1); assert.equal(rejected, 0);
        assert.deepEqual([...store.data.keys()], ['input-index']);
        assert.deepEqual(store.data.get('input-index'), []);
    } finally { globalThis.fetch = original; }
});

test('Node cancellation cannot approve a late result; restart clears orphaned jobs instead of resubmitting', async () => {
    const original = globalThis.fetch, store = fixture(), inputs = new NodeInputs(store, config, 5);
    let current = true, approvals = 0, notify!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { notify = resolve; }), response = new Promise<void>(resolve => { release = resolve; });
    globalThis.fetch = async (_url, options) => { notify(); await response; return Response.json({ decision: 'allow', digest: new Headers(options?.headers).get('x-content-sha256'), decodeComplete: true, policyVersion: config.MODERATION_POLICY_VERSION, modelVersion: config.MODERATION_MODEL_VERSION }); };
    try {
        await inputs.submit(submission(), testImageData(832, 624), { current: () => current, approved: async () => { approvals++; }, rejected: async () => {} });
        await started; current = false; inputs.sweep(); release(); await waitFor(() => !inputs.has('TEST'));
        assert.equal(approvals, 0);
        const scoped = { get: <T>(key: string) => store.get<T>('TEST:' + key), put: (key: string, value: unknown) => store.put('TEST:' + key, value), delete: (key: string) => store.delete('TEST:' + key) };
        await store.put('input-index', ['TEST']);
        await new PendingInputs(scoped).create(submission(), testImageData(832, 624));
        globalThis.fetch = async () => { throw new Error('Restart must not submit'); };
        await new NodeInputs(store, config).cleanupOnStart();
        assert.deepEqual([...store.data.keys()], ['input-index']);
    } finally { release?.(); globalThis.fetch = original; }
});

test('cancelling while private input is being written cannot orphan chunks or lose its cleanup index', async () => {
    const original = globalThis.fetch, base = fixture(); let current = true, notify!: () => void, release!: () => void, delayed = false;
    const started = new Promise<void>(resolve => { notify = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
    const store = { ...base, put: async (key: string, value: unknown) => {
        await base.put(key, value);
        if (key === 'TEST:pendingInput' && !delayed) { delayed = true; notify(); await resume; }
    } };
    globalThis.fetch = async () => { throw new Error('Cancelled input must not call moderation'); };
    try {
        const inputs = new NodeInputs(store, config, 5);
        const pending = inputs.submit(submission(), testImageData(832, 624), { current: () => current, approved: async () => { throw new Error('Must not approve'); }, rejected: async () => {} });
        await started; current = false; inputs.sweep();
        assert.equal(inputs.has('TEST'), true, 'write retains ownership until cleanup can see all chunks');
        release(); await pending; assert.equal(inputs.has('TEST'), false);
        assert.deepEqual([...base.data.keys()], ['input-index']);
    } finally { release?.(); globalThis.fetch = original; }
});
