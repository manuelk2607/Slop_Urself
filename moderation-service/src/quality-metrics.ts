import { semanticAssessment } from './policy.js';

// A diagnostic summary cannot grant release. In particular, timeouts and
// parser failures are availability failures, not successful risk recognition.
export function qualityMetrics(value: unknown) {
    if (!Array.isArray(value) || value.length > 10_000) throw new Error('Invalid diagnostic cases');
    let labelled = 0, unlabelled = 0, technical = 0, benign = 0, risk = 0;
    let falsePositives = 0, falseNegatives = 0, correctlyHeld = 0, correctlyAllowed = 0;
    let invalidAllowResults = 0;
    const ids = new Set<string>(), times: number[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('Missing or duplicate case identity');
        ids.add(item.id);
        if (!['allow', 'hold'].includes(item.expected)) { unlabelled++; continue; }
        labelled++;
        const reason = item.assessmentReason ?? item.assessment?.reason;
        const measured = typeof item.elapsedMs === 'number' && Number.isFinite(item.elapsedMs) && item.elapsedMs > 0;
        if (measured) times.push(item.elapsedMs);
        if (item.outcome === 'technical_failure' || !measured || item.elapsedMs >= 25_000 || item.decodeComplete === false
            || !semanticAssessment(item.decision, reason)) {
            technical++; if (item.decision === 'allow') invalidAllowResults++; continue;
        }
        if (item.expected === 'allow') { benign++; if (item.decision === 'allow') correctlyAllowed++; else falsePositives++; }
        else { risk++; if (item.decision === 'allow') falseNegatives++; else { correctlyHeld++; } }
    }
    times.sort((a, b) => a - b);
    const rate = (count: number, total: number) => total ? count / total : null;
    // Wilson upper bound prevents "zero observed misses" from implying zero risk.
    const upper95 = (count: number, total: number) => {
        if (!total) return null;
        const z2 = 1.96 ** 2, p = count / total;
        return (p + z2 / (2 * total) + 1.96 * Math.sqrt(p * (1 - p) / total + z2 / (4 * total ** 2))) / (1 + z2 / total);
    };
    return { purpose: 'moderation-diagnostic-summary', qualified: false, sufficientForQualification: false,
        labelled, unlabelled, technicalFailures: technical, invalidAllowResults,
        semanticBenignCases: benign, semanticRiskCases: risk, correctlyAllowed, correctlyHeld,
        falsePositives, falseNegatives, falsePositiveRate: rate(falsePositives, benign), falseNegativeRate: rate(falseNegatives, risk),
        riskMissRateWilsonUpper95: upper95(falseNegatives, risk), technicalFailureRate: rate(technical, labelled),
        latencyP95Ms: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
        limitations: ['Conditional error rates exclude technical failures; always inspect availability separately.',
            'Safe prompt-intent examples and synthetic images do not qualify real image/video abuse detection.',
            'Labels, licenses, independence and corpus representativeness require external review.'] };
}
