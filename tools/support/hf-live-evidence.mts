import { readFile, mkdir, writeFile, open } from 'node:fs/promises';
import { dirname } from 'node:path';
export interface LiveEvidence {
    version: 1; expectedUsername: string; origin: string; profile: string; stage: string;
    submittedAt?: string; roomCode?: string; videoPath?: string; duration?: number;
    before?: { username: string; remaining: number; total: number };
    after?: { username: string; remaining: number; total: number };
    rangeVerified?: boolean; playbackVerified?: boolean; debit?: number; success?: boolean;
    billingVerified?: false; quotaObservation?: 'aggregate-only'; afterObservedAt?: string;
}
export async function checkLiveEvidence(path: string) {
    try {
        const evidence = JSON.parse(await readFile(path, 'utf8')) as LiveEvidence;
        if (evidence.submittedAt) throw new Error('Bereits eingereichter oder unklarer Auftrag: kein weiterer automatischer Versuch erlaubt.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function lockLiveEvidence(path: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const handle = await open(`${path}.lock`, 'wx', 0o600);
    return async () => { await handle.close(); const { unlink } = await import('node:fs/promises'); await unlink(`${path}.lock`); };
}
export const saveLiveEvidence = (path: string, evidence: LiveEvidence) => writeFile(path, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
