import { GpuQuotaError, QuotaBudget, type BudgetStorage, type QuotaConfig, type QuotaCapacity } from './quota';
import type { GenerationQuality } from './providers';
import { HfRequiredError, type HfConnections } from '../auth/huggingface';
import { boundedJson } from '../server/body';

export interface BudgetPlayer { id: string; accountId?: string; hfConnectionId?: string }
interface Owner extends BudgetPlayer { subject: string; central: boolean }
interface Plan { owners: Owner[]; jobs: Record<string, string>; members: string[]; expiresAt: number }

// Calls are serialized by the service object (or Node's withBudget), across all rooms.
export class PlayerQuotaBudget {
    private legacy: QuotaBudget;
    constructor(private storage: BudgetStorage, private config: QuotaConfig, private connections: HfConnections) {
        this.legacy = new QuotaBudget(storage, config);
    }
    private key(code: string, owner: Owner) { return `${code}:${owner.id}`; }
    private async owners(players: BudgetPlayer[]): Promise<Owner[]> {
        players = players.map(({ id, accountId, hfConnectionId }) => ({ id, accountId, hfConnectionId }));
        if (!players.length || new Set(players.map(p => p.id)).size !== players.length) throw new Error('Ungültige Spielerliste.');
        // Preserve pre-migration holds for their known owner without using the server token.
        const cached = await this.storage.get<{ subject: string }>('central-identity');
        const owners: Owner[] = [];
        for (const player of players) {
            const credential = await this.connections.credential(player.hfConnectionId, player.accountId);
            owners.push({ ...player, subject: credential.subject, central: credential.subject === cached?.subject });
        }
        return owners;
    }
    private async budget(owner: Owner, needsToken = true) {
        const token = needsToken ? (await this.connections.credential(owner.hfConnectionId, owner.accountId)).token : undefined;
        const prefix = owner.central ? '' : `hf-budget:${owner.subject}:`;
        return new QuotaBudget({ get: key => this.storage.get(prefix + key), put: (key, value) => this.storage.put(prefix + key, value) }, { ...this.config, HF_TOKEN: token });
    }
    private async capacityFor(owners: Owner[], quality: GenerationQuality): Promise<QuotaCapacity> {
        const groups = new Map<string, Owner[]>();
        for (const owner of owners) groups.set(owner.subject, [...groups.get(owner.subject) || [], owner]);
        const capacities: QuotaCapacity[] = [];
        for (const members of groups.values()) capacities.push(await (await this.budget(members[0])).capacity(members.length, quality));
        const unavailable = capacities.find(c => c.quotaMode === 'unavailable');
        if (unavailable) return { aiRoundLimit: 0, playerCount: owners.length, quotaMode: 'unavailable', sharedQuota: false, error: 'Mindestens eine HF-Verbindung ist nicht erreichbar. Bitte erneut verbinden.' };
        return { ...(capacities.length === 1 ? capacities[0] : {}), aiRoundLimit: Math.min(...capacities.map(c => c.aiRoundLimit)), playerCount: owners.length, quotaMode: 'live', sharedQuota: false };
    }
    async capacity(players = 1, quality: GenerationQuality = 'auto', participants?: BudgetPlayer[]): Promise<QuotaCapacity> {
        if (this.config.AI_PROVIDER === 'mock') return this.legacy.capacity(players, quality);
        try {
            if (!participants || participants.length !== players) throw new HfRequiredError();
            return await this.capacityFor(await this.owners(participants), quality);
        } catch { return { aiRoundLimit: 0, playerCount: players, quotaMode: 'unavailable', sharedQuota: false, error: 'Alle Spieler müssen ihr persönliches Hugging-Face-Konto verbinden.' }; }
    }
    async displayCapacity(players = 1, quality: GenerationQuality = 'auto', participants?: BudgetPlayer[]) {
        return this.config.AI_PROVIDER === 'mock' ? this.legacy.displayCapacity(players, quality) : this.capacity(players, quality, participants);
    }
    async reserve(code: string, rounds: number, players = 1, quality: GenerationQuality = 'auto', participants?: BudgetPlayer[]) {
        const previous = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (previous) {
            if (Object.keys(previous.jobs).length && previous.expiresAt > Date.now()) throw new Error('In diesem Raum läuft noch ein KI-Auftrag.');
            for (const owner of previous.owners) await (await this.budget(owner, false)).release(this.key(code, owner));
            await this.storage.put(`quota-plan:${code}`, null);
        }
        if (this.config.AI_PROVIDER === 'mock') return this.legacy.reserve(code, rounds, players, quality);
        if (!participants) throw new HfRequiredError();
        if (!Number.isSafeInteger(rounds) || rounds < 1 || participants.length !== players) throw new Error('Ungültige Rundenzahl oder Spielerliste.');
        const owners = await this.owners(participants), capacity = await this.capacityFor(owners, quality);
        if (rounds > capacity.aiRoundLimit) throw new Error('Das persönliche KI-Kontingent reicht nicht bei allen Spielern für diese Rundenzahl.');
        const reserved: Owner[] = [];
        try {
            for (const owner of owners) {
                await (await this.budget(owner)).reserve(this.key(code, owner), rounds, 1, quality);
                reserved.push(owner);
            }
            await this.storage.put(`quota-plan:${code}`, { owners, jobs: {}, members: owners.map(p => p.id), expiresAt: Date.now() + 2 * 60 * 60_000 } satisfies Plan);
        } catch (error) {
            for (const owner of reserved) await (await this.budget(owner, false)).release(this.key(code, owner));
            throw error;
        }
    }
    async extend(code: string, players: number, quality: GenerationQuality = 'auto', participants?: BudgetPlayer[]) {
        participants = participants?.map(({ id, accountId, hfConnectionId }) => ({ id, accountId, hfConnectionId }));
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) return this.config.AI_PROVIDER === 'mock' ? this.legacy.extend(code, players, quality) : this.reserve(code, 1, players, quality, participants);
        const owners = await this.currentOwners(plan, participants);
        if ((await this.capacityFor(owners, quality)).aiRoundLimit < 1) throw new Error('Das persönliche KI-Kontingent reicht nicht für eine Zusatzrunde.');
        const extended: Owner[] = [];
        try {
            for (const owner of owners) { await (await this.budget(owner)).extend(this.key(code, owner), 1, quality); extended.push(owner); }
            plan.owners = [...plan.owners.filter(p => !owners.some(current => current.id === p.id)), ...owners];
            plan.members = owners.map(p => p.id);
            plan.expiresAt = Date.now() + 2 * 60 * 60_000;
            await this.storage.put(`quota-plan:${code}`, plan);
        } catch (error) {
            for (const owner of extended) await (await this.budget(owner, false)).drop(this.key(code, owner), 1);
            throw error;
        }
    }
    private async currentOwners(plan: Plan, participants?: BudgetPlayer[]) {
        if (!participants) throw new HfRequiredError();
        const owners = await this.owners(participants);
        for (const owner of owners) if (!plan.owners.some(previous => previous.id === owner.id && previous.accountId === owner.accountId && previous.subject === owner.subject)) throw new Error('Das HF-Konto darf während einer Partie nicht gewechselt werden.');
        return owners;
    }
    async begin(code: string, generations = 1, jobId: string = crypto.randomUUID(), playerId?: string, ownRemaining = 1, participant?: BudgetPlayer) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) {
            if (this.config.AI_PROVIDER === 'mock') return this.legacy.begin(code, generations, jobId);
            throw new HfRequiredError();
        }
        let owner = plan.owners.find(p => p.id === playerId);
        if (!owner || plan.jobs[jobId]) throw new Error('Kein persönliches KI-Budget für diesen Spieler.');
        if (!participant || participant.id !== playerId) throw new HfRequiredError();
        owner = (await this.currentOwners(plan, [participant]))[0];
        await this.connections.pinJob(owner.hfConnectionId!, owner.accountId!, jobId);
        try { await (await this.budget(owner)).begin(this.key(code, owner), ownRemaining, jobId); }
        catch (error) {
            await this.connections.forgetJob(jobId);
            if (error instanceof GpuQuotaError && [401, 403].includes(error.status)) throw new HfRequiredError();
            throw error;
        }
        plan.owners = plan.owners.map(p => p.id === owner!.id ? owner! : p);
        plan.jobs[jobId] = owner.id;
        plan.expiresAt = Date.now() + 2 * 60 * 60_000;
        await this.storage.put(`quota-plan:${code}`, plan);
    }
    async tokenForJob(code: string, jobId: string) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (this.config.AI_PROVIDER === 'mock') return undefined;
        if (!plan) throw new HfRequiredError();
        const owner = plan.owners.find(p => p.id === plan.jobs[jobId]);
        if (!owner) throw new Error('KI-Auftrag hat keinen verifizierten Budgetinhaber.');
        if (!owner.hfConnectionId || !owner.accountId) throw new HfRequiredError();
        const credential = await this.connections.jobCredential(jobId);
        if (credential.accountId !== owner.accountId || credential.subject !== owner.subject) throw new HfRequiredError();
        // Verify the token itself, not only the metadata sealed alongside it.
        // A swapped/stale credential must never charge another HF identity.
        const identity = await fetch('https://huggingface.co/api/whoami-v2', { headers: { authorization: `Bearer ${credential.token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if ([401, 403].includes(identity.status)) throw new HfRequiredError();
        if (!identity.ok) throw new Error('Die persönliche HF-Identität ist vorübergehend nicht prüfbar. Es wurde kein Videoauftrag gestartet.');
        let user: { id?: unknown };
        try { user = await boundedJson(identity, 32_768) as typeof user; }
        catch { throw new Error('Die persönliche HF-Identität konnte nicht sicher geprüft werden.'); }
        if (!user || user.id !== owner.subject) throw new HfRequiredError();
        return credential.token;
    }
    async allowAttempt(code: string, seconds: number, jobId?: string) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) {
            if (this.config.AI_PROVIDER === 'mock') return this.legacy.allowAttempt(code, seconds, jobId);
            throw new HfRequiredError();
        }
        const owner = plan.owners.find(p => p.id === plan.jobs[jobId || '']);
        if (!owner || !jobId) throw new Error('KI-Auftrag hat keinen Budgetinhaber.');
        const token = await this.tokenForJob(code, jobId);
        const prefix = owner.central ? '' : `hf-budget:${owner.subject}:`;
        const budget = new QuotaBudget({ get: key => this.storage.get(prefix + key), put: (key, value) => this.storage.put(prefix + key, value) }, { ...this.config, HF_TOKEN: token });
        return budget.allowAttempt(this.key(code, owner), seconds, jobId);
    }
    async consume(code: string, jobId?: string) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) return this.legacy.consume(code, jobId);
        const owner = plan.owners.find(p => p.id === plan.jobs[jobId || '']);
        if (!owner || !jobId) return;
        await (await this.budget(owner, false)).consume(this.key(code, owner), jobId);
        delete plan.jobs[jobId];
        await this.storage.put(`quota-plan:${code}`, plan);
        await this.connections.forgetJob(jobId);
    }
    async release(code: string) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) return this.legacy.release(code);
        for (const owner of plan.owners) await (await this.budget(owner, false)).release(this.key(code, owner));
    }
    async drop(code: string, generations: number, playerId?: string) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) return this.legacy.drop(code, generations);
        const owners = plan.owners.filter(p => playerId ? p.id === playerId : plan.members.includes(p.id));
        if (!owners.length || (!playerId && generations % owners.length)) throw new Error('Persönliches KI-Budget muss einem Spieler zugeordnet sein.');
        for (const owner of owners) await (await this.budget(owner, false)).drop(this.key(code, owner), playerId ? generations : generations / owners.length);
    }
}
