import { randomUUID } from 'node:crypto';
import { HfConnections, type HfConfig, type HfStorage } from './huggingface';
import { PlayerQuotaBudget } from '../ai/player-quota';
import { fetchGpuQuota } from '../ai/quota';
import type { Account } from './session';

const paths = new Map([
    ['/oauth/device', 'POST'], ['/oauth/token', 'POST'], ['/oauth/userinfo', 'GET'],
    ['/api/whoami-v2', 'GET'], ['/api/spaces/zero-gpu/quota', 'GET']
]);
// This opt-in diagnostic cannot accidentally submit inference or a paid job.
export function readOnlyHfFetch(base: typeof fetch): typeof fetch {
    return async (input, init) => {
        const request = new Request(input, init), url = new URL(request.url);
        if (url.origin !== 'https://huggingface.co' || url.username || url.password || url.search || url.hash
            || paths.get(url.pathname) !== request.method) throw new Error('HF preflight forbids this network operation');
        return base(request, { redirect: 'error' });
    };
}

export type TestSlot = 'A' | 'B';
export class HfPreflight {
    private data = new Map<string, unknown>();
    private closed = false;
    private slots: Record<TestSlot, { account: Account; nonce?: string; connection?: string }>;
    private hf: HfConnections;
    private storage: HfStorage;
    constructor(config: HfConfig, private origin: string) {
        this.slots = Object.fromEntries(['A', 'B'].map(id => [id, { account: { id: randomUUID(), name: `HF-Test-${id}`, identityProof: 'owner', expiresAt: Date.now() + 3600_000 } }])) as typeof this.slots;
        this.storage = {
            get: async <T>(key: string) => { this.active(); return structuredClone(this.data.get(key)) as T | undefined; },
            put: async (key, value) => { this.active(); this.data.set(key, structuredClone(value)); },
            delete: async key => { this.active(); return this.data.delete(key); }
        };
        this.hf = new HfConnections(this.storage, config);
    }
    private active() { if (this.closed) throw new Error('HF preflight is closed'); }
    close() { this.closed = true; this.data.clear(); }
    async status() {
        this.active();
        const result: Record<string, unknown> = {};
        for (const id of ['A', 'B'] as const) {
            const slot = this.slots[id];
            if (slot.connection) {
                const value = await this.hf.credential(slot.connection, slot.account.id);
                result[id] = { connected: true, username: value.username };
            } else if (slot.nonce) result[id] = await this.hf.deviceStatus(slot.nonce, slot.account.id, this.origin);
            else result[id] = { connected: false };
        }
        return result;
    }
    async start(id: TestSlot) {
        this.active(); const slot = this.slots[id];
        if (slot.connection) return;
        if (slot.nonce && (await this.hf.deviceStatus(slot.nonce, slot.account.id, this.origin)).pending) return;
        slot.nonce = (await this.hf.startDevice(slot.account, this.origin)).nonce;
    }
    async poll(id: TestSlot) {
        this.active(); const slot = this.slots[id];
        if (!slot.nonce || slot.connection) return;
        const value = await this.hf.pollDevice(slot.nonce, slot.account, this.origin);
        if ('connected' in value && value.connected) slot.connection = value.connection;
        if ('error' in value && value.error) { slot.nonce = undefined; throw new Error('HF consent failed or expired'); }
    }
    async check() {
        this.active();
        const a = this.slots.A, b = this.slots.B;
        const credentials = await Promise.all([a, b].map(slot => this.hf.credential(slot.connection, slot.account.id)));
        if (credentials[0].subject === credentials[1].subject) throw new Error('Two different HF accounts are required');
        const snapshot = async () => Promise.all(credentials.map(async credential => {
            const q = await fetchGpuQuota({ HF_TOKEN: credential.token });
            return { base: q.base, remaining: q.current, resetsAt: q.resetsAt, runs: q.runs?.remaining, observedAt: new Date().toISOString() };
        }));
        const before = await snapshot();
        let foreignCredentialRejected = false;
        try { await this.hf.credential(b.connection, a.account.id); } catch { foreignCredentialRejected = true; }
        if (!foreignCredentialRejected) throw new Error('Foreign credential was accepted');
        const participants = [a, b].map((slot, index) => ({ id: `player-${index}`, accountId: slot.account.id, hfConnectionId: slot.connection }));
        const budget = new PlayerQuotaBudget(this.storage, { AI_PROVIDER: 'wan22', AI_PROVIDER_CHAIN: 'wan22-fast', AI_IMAGE_PROFILE: 'bounded' }, this.hf);
        const capacity = await budget.capacity(2, 'economy', participants);
        const code = 'TEST', jobs = [randomUUID(), randomUUID()];
        let jobOwnersVerified = false, swappedJobRejected = false;
        try {
            if (capacity.aiRoundLimit >= 1) {
                await budget.reserve(code, 1, 2, 'economy', participants);
                for (const [index, player] of participants.entries()) await budget.begin(code, 2, jobs[index], player.id, 1, player);
                const tokens = await Promise.all(jobs.map(job => budget.tokenForJob(code, job)));
                jobOwnersVerified = tokens.every((token, index) => token === credentials[index].token);
                await this.hf.pinJob(b.connection!, b.account.id, jobs[0]);
                try { await budget.tokenForJob(code, jobs[0]); } catch { swappedJobRejected = true; }
                if (!jobOwnersVerified || !swappedJobRejected) throw new Error('Job owner verification failed');
            }
        } finally {
            for (const job of jobs) await budget.consume(code, job);
            await budget.release(code);
        }
        const after = await snapshot();
        return { version: 1, scope: 'read-only HF plus local reservation simulation', checkedAt: new Date().toISOString(),
            distinctAccounts: true, foreignCredentialRejected, jobOwnersVerified, swappedJobRejected,
            localJobCheckSkipped: capacity.aiRoundLimit < 1 ? 'insufficient free quota for local reservation' : undefined,
            before: { A: before[0], B: before[1] }, after: { A: after[0], B: after[1] },
            liveGenerationCalls: 0, billingVerified: false, generationRelease: false,
            limitation: 'Authentication and quota snapshots do not prove per-job debit. No inference endpoint is allowed.' };
    }
}
