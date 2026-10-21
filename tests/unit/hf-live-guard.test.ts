import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLiveEvidence, lockLiveEvidence, saveLiveEvidence } from '../../tools/support/hf-live-evidence.mts';
test('live proof fence blocks any later automatic run after submission and prevents concurrent runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slop-hf-proof-')), path = join(directory, 'evidence.json');
    try {
        await checkLiveEvidence(path);
        const release = await lockLiveEvidence(path);
        await assert.rejects(lockLiveEvidence(path), { code: 'EEXIST' });
        await saveLiveEvidence(path, { version: 1, origin: 'https://game.test', expectedUsername: 'Test', profile: 'isolated', stage: 'submission-uncertain', submittedAt: new Date().toISOString() });
        await assert.rejects(checkLiveEvidence(path), /kein weiterer automatischer Versuch/);
        await release();
        await assert.rejects(checkLiveEvidence(path), /kein weiterer automatischer Versuch/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
