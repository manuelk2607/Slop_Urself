import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModerationJobs } from '../src/jobs.js';

const secret = 'test-only-moderation-storage-secret-32-characters';
const version = 'a'.repeat(64), digest = 'b'.repeat(64);
const input = { stage: 'input' as const, image: 'private-test-image', prompt: 'private-test-prompt' };

test('encrypted jobs survive reopening, deduplicate lost acknowledgements and fence concurrent/restarted workers', t => {
    const dir = mkdtempSync(join(tmpdir(), 'slop-moderation-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'jobs.sqlite'); let now = 1000;
    let store = new ModerationJobs(path, secret, version, () => now);
    const job = store.create(digest, false, input); store.close();
    assert.equal(readFileSync(path).includes(Buffer.from(input.prompt)), false);
    assert.equal(readFileSync(path).includes(Buffer.from(input.image)), false);
    store = new ModerationJobs(path, secret, version, () => now); t.after(() => store.close());
    assert.equal(store.create(digest, false, input).id, job.id, 'lost acknowledgement does not create another job');
    const first = store.claim()!; assert.deepEqual(first.input, input);
    const other = new ModerationJobs(path, secret, version, () => now); t.after(() => other.close());
    assert.equal(other.claim(), undefined, 'exclusive compute lease across connections');
    now += 300_001;
    const retry = other.claim()!; assert.equal(retry.id, first.id); assert.notEqual(retry.run, first.run);
    assert.equal(store.finish(first.id, first.run, { decision: 'allow' }), false, 'late worker cannot approve');
    assert.equal(other.finish(retry.id, retry.run, { decision: 'review' }), true);
    assert.equal(other.finish(retry.id, retry.run, { decision: 'allow' }), false, 'terminal decision cannot change');
    assert.deepEqual(store.get(job.id, digest)?.result, { decision: 'review' });
    assert.equal(store.get(job.id, 'c'.repeat(64)), undefined);
    now += 60_000; assert.equal(store.get(job.id, digest), undefined);
});

test('version changes and rotated/wrong encryption keys cannot recover approvals or payloads', t => {
    const dir = mkdtempSync(join(tmpdir(), 'slop-moderation-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'jobs.sqlite');
    const original = new ModerationJobs(path, secret, version); t.after(() => original.close());
    const job = original.create(digest, false, input);
    const changed = new ModerationJobs(path, secret, 'c'.repeat(64)); t.after(() => changed.close());
    assert.equal(changed.get(job.id, digest), undefined); assert.equal(changed.claim(), undefined);
    const wrong = new ModerationJobs(path, 'wrong-key-at-least-thirty-two-characters', version); t.after(() => wrong.close());
    assert.throws(() => wrong.claim());
    assert.equal(original.get(job.id, digest)?.status, 'pending', 'failed decryption rolls back claim');
});

test('capacity, expiry, bounded output and expired lease reject publication', t => {
    let now = 1000; const store = new ModerationJobs(':memory:', secret, version, () => now); t.after(() => store.close());
    const first = store.create(digest, true, input);
    for (let n = 1; n < 4; n++) store.create(String(n).repeat(64), true, input);
    assert.throws(() => store.create('5'.repeat(64), true, input));
    const claim = store.claim()!;
    assert.throws(() => store.finish(first.id, claim.run, { text: 'x'.repeat(20_000) }));
    now += 300_001; assert.equal(store.finish(first.id, claim.run, { decision: 'allow' }), false);
    now += 60_000; assert.equal(store.get(first.id, digest), undefined); assert.equal(store.claim(), undefined);
    assert.ok(store.create('5'.repeat(64), false, input));
});
