import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualificationEvidence } from '../src/evidence.js';
import { qualificationValid, POLICY_VERSION } from '../src/policy.js';

// Parser fixtures only. These are not measured model evaluations or a release.
function fixture() {
    const now = Date.now(), version = 'd'.repeat(64);
    const cases = ['sexual_minors', 'nonconsensual', 'graphic_abuse', 'benign_de', 'benign_en', 'benign_video'].flatMap(group =>
        Array.from({ length: group === 'benign_video' ? 3 : group.startsWith('benign_') ? 10 : 5 }, (_, i) => ({
            id: `${group}-${i}`, group, expected: group.startsWith('benign_') ? 'allow' : 'hold', decision: group.startsWith('benign_') ? 'allow' : 'block',
            elapsedMs: 100, decodeComplete: true, ...(group === 'benign_video' ? { frameCount: 81, framesChecked: 81, uniqueFramesChecked: 81, durationSeconds: 5, codec: 'h264', pixelFormat: 'yuv420p' } : {})
        })));
    const report = { purpose: 'moderation-qualification', sufficientForQualification: true, policyVersion: POLICY_VERSION, modelVersion: version, completedAt: new Date(now).toISOString(), cases };
    return { now, version, report, bytes: () => Buffer.from(JSON.stringify(report)) };
}
test('qualification requires the exact report, measured outcomes, adequate coverage and valid frame checks', () => {
    const f = fixture(), evidence = qualificationEvidence(f.bytes(), f.version, f.now)!;
    assert.ok(evidence); assert.equal(evidence.benignCases, 23); assert.equal(evidence.latencyP95Ms, 100);
    const q = { policyVersion: POLICY_VERSION, modelVersion: f.version, ownerReviewed: true, licensesReviewed: true,
        expiresAt: new Date(f.now + 86400_000).toISOString(), testReportSha256: evidence.sha256,
        riskGroups: evidence.groups, benignCases: 23, latencyP95Ms: 100 };
    assert.equal(qualificationValid(q, f.version, f.now, evidence), true);
    for (const change of [{ testReportSha256: 'a'.repeat(64) }, { benignCases: 999 }, { latencyP95Ms: 10 }, { ownerReviewed: false }, { licensesReviewed: false }]) {
        assert.equal(qualificationValid({ ...q, ...change }, f.version, f.now, evidence), false);
    }
    assert.equal(qualificationValid(q, f.version, f.now + 32 * 86400_000, evidence), false);
    f.report.cases[0].decision = 'allow'; assert.equal(qualificationEvidence(f.bytes(), f.version, f.now), undefined);
    f.report.cases[0].decision = 'block';
    f.report.cases.at(-1)!.framesChecked = 1; assert.equal(qualificationEvidence(f.bytes(), f.version, f.now), undefined);
    f.report.cases.at(-1)!.framesChecked = 81;
    f.report.cases.at(-1)!.durationSeconds = 2; assert.equal(qualificationEvidence(f.bytes(), f.version, f.now), undefined);
});
test('diagnostic, malformed, stale, sparse, duplicated, slow and excessive false-positive reports never qualify', () => {
    const changes = [
        (r: ReturnType<typeof fixture>['report']) => { r.sufficientForQualification = false; },
        (r: ReturnType<typeof fixture>['report']) => { r.modelVersion = 'wrong'; },
        (r: ReturnType<typeof fixture>['report']) => { r.completedAt = '2020-01-01'; },
        (r: ReturnType<typeof fixture>['report']) => { r.cases = r.cases.slice(0, 2); },
        (r: ReturnType<typeof fixture>['report']) => { r.cases[0].id = r.cases[1].id; },
        (r: ReturnType<typeof fixture>['report']) => { r.cases.forEach(c => { c.elapsedMs = 25_001; }); },
        (r: ReturnType<typeof fixture>['report']) => { r.cases.filter(c => c.group === 'benign_de').slice(0, 2).forEach(c => { c.decision = 'review'; }); },
        (r: ReturnType<typeof fixture>['report']) => { r.cases[0].decodeComplete = false; },
        (r: ReturnType<typeof fixture>['report']) => { r.cases.at(-1)!.uniqueFramesChecked = 1; },
        (r: ReturnType<typeof fixture>['report']) => { delete r.cases.at(-1)!.uniqueFramesChecked; }
    ];
    for (const change of changes) { const f = fixture(); change(f.report); assert.equal(qualificationEvidence(f.bytes(), f.version, f.now), undefined); }
    assert.equal(qualificationEvidence(Buffer.from('{}'), 'x'), undefined);
    assert.equal(qualificationEvidence(new Uint8Array(1024 * 1024 + 1), 'x'), undefined);
});
