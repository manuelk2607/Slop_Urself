import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, modelVersion, qualificationValid, POLICY_VERSION } from '../src/policy.js';
test('unclear, malformed, sexual and incomplete assessments never approve', () => {
    const safe = { safe: true, sexual: false, sexualMinors: false, nonConsensual: false, graphicAbuse: false, uncertain: false };
    const scores = [{ label: 'normal', score: 0.99 }, { label: 'nsfw', score: 0.01 }];
    assert.equal(decide(scores, JSON.stringify(safe)), 'allow');
    for (const value of ['', '{}', JSON.stringify({ ...safe, uncertain: true }), JSON.stringify({ ...safe, sexual: true })]) assert.equal(decide(scores, value), 'review');
    assert.equal(decide([], JSON.stringify(safe)), 'review');
    assert.equal(decide([{ label: 'nsfw', score: 0.99 }], JSON.stringify(safe)), 'block');
    assert.equal(decide(scores, JSON.stringify({ ...safe, sexualMinors: true })), 'block');
});
test('qualification is tied to immutable models, policy, expiry and a real reviewed test report', () => {
    const lock = { nsfw: { id: 'a/model', revision: 'a'.repeat(40) }, vlm: { id: 'b/model', revision: 'b'.repeat(40) } };
    const version = modelVersion(lock, 'a'.repeat(64)); assert.equal(qualificationValid(undefined, version), false);
    assert.throws(() => modelVersion({ ...lock, vlm: { ...lock.vlm, revision: 'main' } }, 'a'.repeat(64)));
    assert.throws(() => modelVersion(lock, ''));
    assert.notEqual(modelVersion(lock, 'b'.repeat(64)), version);
    const value = { policyVersion: POLICY_VERSION, modelVersion: version, expiresAt: new Date(Date.now() + 86400_000).toISOString(), ownerReviewed: true, licensesReviewed: true,
        testReportSha256: 'c'.repeat(64), riskGroups: ['sexual_minors', 'nonconsensual', 'graphic_abuse', 'benign_de', 'benign_en'], benignCases: 30, latencyP95Ms: 20000 };
    assert.equal(qualificationValid(value, version), true);
    assert.equal(qualificationValid({ ...value, latencyP95Ms: 40000 }, version), false);
    assert.equal(qualificationValid({ ...value, ownerReviewed: false }, version), false);
    assert.equal(qualificationValid(value, 'wrong'), false);
    assert.equal(qualificationValid(value, modelVersion(lock, 'b'.repeat(64))), false, 'Changed runtime cannot reuse an old review.');
});
