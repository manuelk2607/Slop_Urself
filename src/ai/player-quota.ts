import { QuotaBudget, type BudgetStorage, type QuotaConfig, type QuotaCapacity } from './quota';
import type { GenerationQuality } from './providers';
import type { HfConnections } from '../auth/huggingface';

export interface BudgetPlayer { id: string; accountId?: string; hfConnectionId?: string }
interface Owner extends BudgetPlayer { subject: string; central: boolean }
interface Plan { owners: Owner[]; jobs: Record<string, string>; members: string[]; expiresAt: number }

// Calls are serialized by the service object (or Node's withBudget), across all rooms.
export class PlayerQuotaBudget {
    private legacy: QuotaBudget;
    private centralSubject?: string;
    constructor(private storage: BudgetStorage, private config: QuotaConfig, private connections: HfConnections) {
        this.legacy = new QuotaBudget(storage, config);
    }
    private key(code: string, owner: Owner) { return `${code}:${owner.id}`; }
    private async owners(players: BudgetPlayer[]): Promise<Owner[]> {
        players = players.map(({ id, accountId, hfConnectionId }) => ({ id, accountId, hfConnectionId }));
        if (!players.length || new Set(players.map(p => p.id)).size !== players.length) throw new Error('Ungültige Spielerliste.');
        if (!this.centralSubject && this.config.HF_TOKEN) {
            const response = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${this.config.HF_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
            if (!response.ok) throw new Error('Das gemeinsame HF-Konto ist gerade nicht erreichbar.');
            const user = await response.json() as { id?: unknown };
            if (typeof user.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.id)) throw new Error('Ungültiges gemeinsames HF-Profil.');
            this.centralSubject = user.id;
        }
        const owners: Owner[] = [];
        for (const player of players) {
            const credential = player.hfConnectionId ? await this.connections.credential(player.hfConnectionId, player.accountId) : undefined;
            const subject = credential?.subject || this.centralSubject || 'central';
            owners.push({ ...player, subject, central: subject === (this.centralSubject || 'central') });
        }
        return owners;
    }
    private async budget(owner: Owner, needsToken = true) {
        const token = needsToken ? owner.hfConnectionId
            ? (await this.connections.credential(owner.hfConnectionId, owner.accountId)).token : this.config.HF_TOKEN : undefined;
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
        return { aiRoundLimit: Math.min(...capacities.map(c => c.aiRoundLimit)), playerCount: owners.length, quotaMode: 'live', sharedQuota: false };
    }
    async capacity(players = 1, quality: GenerationQuality = 'auto', participants?: BudgetPlayer[]): Promise<QuotaCapacity> {
        if (this.config.AI_PROVIDER === 'mock' || !participants?.some(p => p.hfConnectionId)) return this.legacy.capacity(players, quality);
        try {
            if (participants.length !== players) throw new Error('Spielerzahl geändert.');
            return await this.capacityFor(await this.owners(participants), quality);
        } catch { return { aiRoundLimit: 0, playerCount: players, quotaMode: 'unavailable', sharedQuota: false, error: 'Bitte prüft eure HF-Verbindungen.' }; }
    }
    async displayCapacity(players = 1, quality: GenerationQuality = 'auto', participants?: BudgetPlayer[]) {
        return participants?.some(p => p.hfConnectionId) ? this.capacity(players, quality, participants) : this.legacy.displayCapacity(players, quality);
    }
    async reserve(code: string, rounds: number, players = 1, quality: GenerationQuality = 'auto', participants?: BudgetPlayer[]) {
        const previous = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (previous) {
            if (Object.keys(previous.jobs).length && previous.expiresAt > Date.now()) throw new Error('In diesem Raum läuft noch ein KI-Auftrag.');
            for (const owner of previous.owners) await (await this.budget(owner, false)).release(this.key(code, owner));
            await this.storage.put(`quota-plan:${code}`, null);
        }
        if (this.config.AI_PROVIDER === 'mock' || !participants?.some(p => p.hfConnectionId)) return this.legacy.reserve(code, rounds, players, quality);
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
        if (!plan) return participants?.some(p => p.hfConnectionId)
            ? this.reserve(code, 1, players, quality, participants) : this.legacy.extend(code, players, quality);
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
        if (!participants) return plan.owners;
        const owners = await this.owners(participants);
        for (const owner of owners) if (!plan.owners.some(previous => previous.id === owner.id && previous.subject === owner.subject)) throw new Error('Das HF-Konto darf während einer Partie nicht gewechselt werden.');
        return owners;
    }
    async begin(code: string, generations = 1, jobId: string = crypto.randomUUID(), playerId?: string, ownRemaining = 1, participant?: BudgetPlayer) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) return this.legacy.begin(code, generations, jobId);
        let owner = plan.owners.find(p => p.id === playerId);
        if (!owner || plan.jobs[jobId]) throw new Error('Kein persönliches KI-Budget für diesen Spieler.');
        if (participant) owner = (await this.currentOwners(plan, [participant]))[0];
        if (owner.hfConnectionId) await this.connections.pinJob(owner.hfConnectionId, owner.accountId!, jobId);
        try { await (await this.budget(owner)).begin(this.key(code, owner), ownRemaining, jobId); }
        catch (error) { await this.connections.forgetJob(jobId); throw error; }
        plan.owners = plan.owners.map(p => p.id === owner!.id ? owner! : p);
        plan.jobs[jobId] = owner.id;
        plan.expiresAt = Date.now() + 2 * 60 * 60_000;
        await this.storage.put(`quota-plan:${code}`, plan);
    }
    async tokenForJob(code: string, jobId: string) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) return this.config.HF_TOKEN;
        const owner = plan.owners.find(p => p.id === plan.jobs[jobId]);
        if (!owner) throw new Error('KI-Auftrag hat keinen verifizierten Budgetinhaber.');
        return owner.hfConnectionId ? (await this.connections.jobCredential(jobId)).token : this.config.HF_TOKEN;
    }
    async allowAttempt(code: string, seconds: number, jobId?: string) {
        const plan = await this.storage.get<Plan>(`quota-plan:${code}`);
        if (!plan) return this.legacy.allowAttempt(code, seconds, jobId);
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
