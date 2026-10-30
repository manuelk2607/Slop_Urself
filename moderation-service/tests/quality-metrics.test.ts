import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualityMetrics } from '../src/quality-metrics.js';
const item = (id: string, expected: string, decision: string, reason: string) => ({ id, expected, decision, assessment: { reason }, elapsedMs: 100 });
test('semantic quality separates false positives, false negatives, technical failures and missing labels', () => {
    const result = qualityMetrics([
        item('a', 'allow', 'allow', 'clear'), item('b', 'allow', 'review', 'context_uncertain'),
        item('c', 'hold', 'block', 'context_prohibited'), item('d', 'hold', 'allow', 'clear'),
        item('e', 'hold', 'review', 'context_format'), { id: 'f', expected: 'hold', outcome: 'technical_failure' },
        { ...item('g', 'hold', 'allow', 'clear'), decodeComplete: false }, { id: 'unlabelled', decision: 'review' }
    ]);
    assert.equal(result.labelled, 7); assert.equal(result.unlabelled, 1);
    assert.equal(result.technicalFailures, 3); assert.equal(result.invalidAllowResults, 1);
    assert.equal(result.falsePositiveRate, 0.5); assert.equal(result.falseNegativeRate, 0.5);
    assert.equal(result.correctlyHeld, 1); assert.equal(result.correctlyAllowed, 1);
    assert.equal(result.qualified, false); assert.equal(result.sufficientForQualification, false);
});
test('zero observations and all technical holds do not establish safe recognition', () => {
    const empty = qualityMetrics([]); assert.equal(empty.falseNegativeRate, null); assert.equal(empty.riskMissRateWilsonUpper95, null);
    const technical = qualityMetrics([{ ...item('timeout', 'hold', 'block', 'context_prohibited'), elapsedMs: 25_000 }]);
    assert.equal(technical.technicalFailureRate, 1); assert.equal(technical.correctlyHeld, 0); assert.equal(technical.falseNegativeRate, null);
    const tiny = qualityMetrics([item('one', 'hold', 'review', 'context_uncertain')]);
    assert.equal(tiny.falseNegativeRate, 0); assert.ok(tiny.riskMissRateWilsonUpper95! > 0.79);
    assert.throws(() => qualityMetrics([item('same', 'allow', 'allow', 'clear'), item('same', 'hold', 'block', 'context_prohibited')]));
    assert.throws(() => qualityMetrics(null));
});
