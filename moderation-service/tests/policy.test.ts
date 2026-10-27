import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, decide, modelVersion, qualificationValid, POLICY_VERSION } from '../src/policy.js';
test('unclear, malformed, sexual and incomplete assessments never approve', () => {
    const safe = { safe: true, sexual: false, sexualMinors: false, nonConsensual: false, graphicAbuse: false, uncertain: false };
    const scores = [{ label: 'normal', score: 0.99 }, { label: 'nsfw', score: 0.01 }];
    assert.equal(decide(scores, JSON.stringify(safe)), 'allow');
    for (const value of ['', '{}', JSON.stringify({ ...safe, uncertain: true }), JSON.stringify({ ...safe, sexual: true })]) assert.equal(decide(scores, value), 'review');
    assert.equal(decide([], JSON.stringify(safe)), 'review');
    assert.equal(decide([{ label: 'nsfw', score: 0.99 }], JSON.stringify(safe)), 'review');
    assert.equal(decide([{ label: 'nsfw', score: 0.99 }, { label: 'normal', score: 0.01 }], JSON.stringify(safe)), 'block');
    for (const malformed of [JSON.stringify({ ...safe, reason: 'unexpected' }), JSON.stringify(safe).replace('"safe":true', '"safe":false,"safe":true')]) assert.equal(decide(scores, malformed), 'review');
    assert.equal(decide([{ label: 'nsfw', score: 0.01 }, { label: 'nsfw', score: 0.99 }], JSON.stringify(safe)), 'review');
    assert.equal(decide(scores, JSON.stringify({ ...safe, sexualMinors: true })), 'block');
});
test('diagnostic review reasons distinguish protocol failures from actual risk without returning model text', () => {
    const scores = [{ label: 'normal', score: 0.99 }, { label: 'nsfw', score: 0.01 }];
    assert.deepEqual(assess(scores, 'private model text'), { decision: 'review', reason: 'context_format' });
    assert.deepEqual(assess(scores, '{}'), { decision: 'review', reason: 'context_schema' });
    assert.deepEqual(assess([], '{}'), { decision: 'review', reason: 'classifier_schema' });
    const context = { safe: true, sexual: false, sexualMinors: false, nonConsensual: false, graphicAbuse: false, uncertain: false };
    assert.deepEqual(assess(scores, JSON.stringify({ ...context, uncertain: true })), { decision: 'review', reason: 'context_uncertain' });
    assert.deepEqual(assess(scores, JSON.stringify(context)), { decision: 'allow', reason: 'clear' });
});
test('experimental labels require the whole enum and preserve classifier holds and distinct version identity', () => {
    const scores = [{ label: 'normal', score: 0.99 }, { label: 'nsfw', score: 0.01 }];
    assert.equal(assess(scores, 'ALLOW', 'labels-v1').decision, 'allow');
    assert.equal(assess(scores, 'BLOCK', 'labels-v1').decision, 'block');
    assert.equal(assess(scores, 'REVIEW', 'labels-v1').decision, 'review');
    for (const value of ['not ALLOW', 'ALLOW because', 'BLOCK ALLOW', '```ALLOW```', '{"decision":"ALLOW"}']) assert.equal(assess(scores, value, 'labels-v1').decision, 'review');
    assert.equal(assess([{ label: 'normal', score: 0.6 }, { label: 'nsfw', score: 0.4 }], 'ALLOW', 'labels-v1').decision, 'review');
    assert.equal(assess([{ label: 'normal', score: 0.1 }, { label: 'nsfw', score: 0.9 }], 'ALLOW', 'labels-v1').decision, 'block');
    assert.equal(assess(scores, 'ALLOW').decision, 'review', 'Default JSON protocol never silently accepts an experiment.');
    const lock = { nsfw: { id: 'a/model', revision: 'a'.repeat(40) }, vlm: { id: 'b/model', revision: 'b'.repeat(40) } };
    assert.notEqual(modelVersion(lock, 'a'.repeat(64)), modelVersion({ ...lock, decisionProtocol: 'labels-v1' }, 'a'.repeat(64)));
});
test('qualification is tied to immutable models, policy, expiry and a real reviewed test report', () => {
    const lock = { nsfw: { id: 'a/model', revision: 'a'.repeat(40) }, vlm: { id: 'b/model', revision: 'b'.repeat(40) } };
    const version = modelVersion(lock, 'a'.repeat(64)); assert.equal(qualificationValid(undefined, version), false);
    assert.throws(() => modelVersion({ ...lock, vlm: { ...lock.vlm, revision: 'main' } }, 'a'.repeat(64)));
    assert.throws(() => modelVersion(lock, ''));
    assert.notEqual(modelVersion(lock, 'b'.repeat(64)), version);
    const value = { policyVersion: POLICY_VERSION, modelVersion: version, expiresAt: new Date(Date.now() + 86400_000).toISOString(), ownerReviewed: true, licensesReviewed: true,
        testReportSha256: 'c'.repeat(64), riskGroups: ['sexual_minors', 'nonconsensual', 'graphic_abuse', 'benign_de', 'benign_en'], benignCases: 30, latencyP95Ms: 20000 };
    assert.equal(qualificationValid(value, version), false, 'Declared report metadata without the actual validated report cannot qualify.');
    assert.equal(qualificationValid({ ...value, latencyP95Ms: 40000 }, version), false);
    assert.equal(qualificationValid({ ...value, ownerReviewed: false }, version), false);
    assert.equal(qualificationValid(value, 'wrong'), false);
    assert.equal(qualificationValid(value, modelVersion(lock, 'b'.repeat(64))), false, 'Changed runtime cannot reuse an old review.');
});
