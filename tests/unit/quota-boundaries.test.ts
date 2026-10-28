import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchGpuQuota, QuotaBudget, type Reservation } from '../../src/ai/quota';

test('HF quota reads bound response bytes, reject redirects, strip unrelated fields and normalize dates', async () => {
    const original = globalThis.fetch;
    let payload: unknown = { base: 300, current: 175.5, resetsAt: '2026-10-28T20:00:00+01:00', runs: { remaining: 7 }, privateBillingField: 'must-not-propagate' };
    try {
        globalThis.fetch = async (_input, options) => { assert.equal(options?.redirect, 'manual'); return Response.json(payload); };
        const q = await fetchGpuQuota({ HF_TOKEN: 'fixture-only' });
        assert.equal(q.resetsAt, '2026-10-28T19:00:00.000Z'); assert.doesNotMatch(JSON.stringify(q), /privateBillingField|must-not-propagate/);
        for (const invalid of [null, [], { base: 300, current: -1, resetsAt: null }, { base: 300, current: 1, resetsAt: null, runs: { remaining: 1, resetsAt: 'not-a-date' } }]) {
            payload = invalid; await assert.rejects(fetchGpuQuota({ HF_TOKEN: 'fixture-only' }));
        }
        payload = { base: 300, current: 1, resetsAt: null, padding: 'x'.repeat(17_000) };
        await assert.rejects(fetchGpuQuota({ HF_TOKEN: 'fixture-only' }), RangeError);
    } finally { globalThis.fetch = original; }
});

test('HF reset does not discard uncertain active jobs, while expired idle holds still lapse', async () => {
    const original = globalThis.fetch;
    const past = new Date(Date.now() - 1000).toISOString(), next = new Date(Date.now() + 3600_000).toISOString();
    const reservation = (active: number): Reservation => ({ rounds: 1, active, activeJobs: active ? { existing: 79 } : {}, expiresAt: Date.now() + 60_000, reset: past, gpuSecondsPerVideo: 79 });
    const data = new Map<string, unknown>([['reservations', { LIVE: reservation(1), IDLE: reservation(0) }]]);
    try {
        globalThis.fetch = async () => Response.json({ base: 300, current: 300, resetsAt: next, runs: { remaining: 8 } });
        const budget = new QuotaBudget({ get: async <T>(key: string) => structuredClone(data.get(key)) as T, put: async (key, value) => { data.set(key, structuredClone(value)); } },
            { HF_TOKEN: 'fixture-only', AI_PROVIDER_CHAIN: 'wan22-fast', AI_IMAGE_PROFILE: 'bounded' });
        const capacity = await budget.capacity(1, 'economy'); assert.equal(capacity.reservedRounds, 1); assert.equal(capacity.aiRoundLimit, 2);
        await budget.begin('LIVE', 1, 'new-job');
        const holds = data.get('reservations') as Record<string, Reservation>;
        assert.equal(holds.LIVE.activeJobs?.existing, 79); assert.equal(holds.LIVE.active, 2); assert.equal(holds.IDLE, undefined);
        await budget.consume('LIVE', 'existing'); assert.equal((data.get('reservations') as typeof holds).LIVE.active, 1);
    } finally { globalThis.fetch = original; }
});
