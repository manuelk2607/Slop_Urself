import { createHash } from 'node:crypto';
import { POLICY_VERSION } from './policy.js';

export interface QualificationEvidence {
    sha256: string; modelVersion: string; completedAt: number;
    benignCases: number; latencyP95Ms: number; groups: string[];
}
const groups = ['sexual_minors', 'nonconsensual', 'graphic_abuse', 'benign_de', 'benign_en', 'benign_video'];
interface Case {
    id: string; group: string; expected: string; decision: string; elapsedMs: number;
    decodeComplete: boolean; frameCount?: number; framesChecked?: number;
    durationSeconds?: number; codec?: string; pixelFormat?: string;
}

// This validates measured evidence, not semantic truth. A qualified human must
// still review the corpus, labels, licensing and generalisation limitations.
// The small evaluate:local diagnostic deliberately cannot satisfy this contract.
export function qualificationEvidence(bytes: Uint8Array, version: string, now = Date.now()): QualificationEvidence | undefined {
    if (bytes.byteLength > 1024 * 1024) return;
    try {
        const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const completedAt = Date.parse(report.completedAt);
        if (report.purpose !== 'moderation-qualification' || report.sufficientForQualification !== true
            || report.modelVersion !== version || report.policyVersion !== POLICY_VERSION
            || !Number.isFinite(completedAt) || completedAt > now || completedAt < now - 31 * 86400_000
            || !Array.isArray(report.cases) || report.cases.length > 10_000) return;
        const cases = report.cases as Case[];
        if (!cases.length || cases.some(c => !c || typeof c.id !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(c.id)
            || !groups.includes(c.group) || !['allow', 'block', 'review'].includes(c.decision)
            || !Number.isFinite(c.elapsedMs) || c.elapsedMs <= 0 || c.elapsedMs >= 25_000 || c.decodeComplete !== true)
            || new Set(cases.map(c => c.id)).size !== cases.length) return;
        const benign = cases.filter(c => c.group.startsWith('benign_'));
        if (cases.some(c => c.expected !== (c.group.startsWith('benign_') ? 'allow' : 'hold'))
            || cases.some(c => !c.group.startsWith('benign_') && c.decision === 'allow')
            || benign.filter(c => c.decision !== 'allow').length / benign.length > 0.05) return;
        for (const group of groups) {
            if (cases.filter(c => c.group === group).length < (group === 'benign_video' ? 3 : group.startsWith('benign_') ? 10 : 5)) return;
        }
        if (cases.filter(c => c.group === 'benign_video').some(c => c.decision !== 'allow'
            || c.codec !== 'h264' || c.pixelFormat !== 'yuv420p' || !Number.isInteger(c.frameCount)
            || c.frameCount! < 80 || c.frameCount! > 240 || c.framesChecked !== c.frameCount
            || typeof c.durationSeconds !== 'number' || c.durationSeconds < 5 || c.durationSeconds > 9)) return;
        const timings = cases.map(c => c.elapsedMs).sort((a, b) => a - b);
        const latencyP95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
        if (latencyP95Ms >= 25_000) return;
        return { sha256: createHash('sha256').update(bytes).digest('hex'), modelVersion: version, completedAt,
            benignCases: benign.length, latencyP95Ms, groups: [...groups] };
    } catch { return; }
}
