import { ProviderConfig, ProviderBudget, providerBudgets, providerGpuSeconds } from './providers';

export interface QuotaConfig extends ProviderConfig { HF_TOKEN?: string; AI_ROUND_LIMIT?: string }
export interface GpuQuota { base: number; current: number; resetsAt: string | null; runs?: { remaining: number; resetsAt?: string } }
export interface Reservation { rounds: number; active: number; expiresAt: number; reset: string | null; gpuSecondsPerVideo?: number; activeJobs?: Record<string, number> }
export interface BudgetStorage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }
export interface QuotaCapacity {
    aiRoundLimit: number;
    playerCount: number;
    quotaMode: 'mock' | 'live' | 'unavailable';
    availableGenerations?: number;
    remainingGpuSeconds?: number;
    reservedRounds?: number;
    resetsAt?: string | null;
    gpuSecondsPerVideo?: number;
    gpuSecondsPerRound?: number;
    providers?: ProviderBudget[];
    budgetProvider?: string;
    sharedQuota?: boolean;
    error?: string;
}
export function playerCount(value: unknown = 1) {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Die Spielerzahl muss eine positive ganze Zahl sein.');
    return count;
}
export function roundsForPlayers(generations: number, players: number) {
    return Math.max(0, Math.floor(generations / playerCount(players)));
}
export async function fetchGpuQuota(config: QuotaConfig): Promise<GpuQuota> {
    if (!config.HF_TOKEN) throw new Error('HF_TOKEN fehlt.');
    const response = await fetch('https://huggingface.co/api/spaces/zero-gpu/quota', {
        headers: { Authorization: `Bearer ${config.HF_TOKEN}` }, signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'HF_TOKEN benoetigt die Berechtigung zum Lesen des Kontingents.' : 'KI-Kontingent momentan nicht erreichbar.');
    const quota = await response.json() as GpuQuota;
    if (!Number.isFinite(quota.current) || quota.current < 0 || !Number.isFinite(quota.base) || quota.base < 0 ||
        (quota.runs && (!Number.isInteger(quota.runs.remaining) || quota.runs.remaining < 0)) ||
        (quota.resetsAt !== null && (typeof quota.resetsAt !== 'string' || !Number.isFinite(Date.parse(quota.resetsAt))))) throw new Error('Ungueltiges KI-Kontingent.');
    return quota;
}
export const requiredGpuSeconds = (duration: number) => providerGpuSeconds('wan22', { LTX_DURATION: String(duration) });
export const secondsPerRound = (config: QuotaConfig) => Math.min(...providerBudgets(config).map(p => p.gpuSeconds));
export function availableRounds(quota: GpuQuota, reserved: number, config: QuotaConfig) {
    if (!Number.isFinite(secondsPerRound(config))) return 0;
    return Math.max(0, Math.min(Math.floor((quota.current - reserved * secondsPerRound(config)) / secondsPerRound(config)),
        (quota.runs?.remaining ?? Number.MAX_SAFE_INTEGER) - reserved));
}

function freeGenerations(quota: GpuQuota, reservations: Record<string, Reservation>, seconds: number) {
    const reservedSeconds = Object.values(reservations).reduce((sum, entry) => sum + reservationSeconds(entry), 0);
    const reservedRuns = Object.values(reservations).reduce((sum, entry) => sum + entry.rounds, 0);
    return Math.max(0, Math.min(Math.floor((quota.current - reservedSeconds) / seconds), (quota.runs?.remaining ?? Number.MAX_SAFE_INTEGER) - reservedRuns));
}
const reservationCost = (entry: Reservation) => entry.gpuSecondsPerVideo || 154;
const reservationSeconds = (entry: Reservation) => entry.rounds * reservationCost(entry)
    + Object.values(entry.activeJobs || {}).reduce((sum, seconds) => sum + Math.max(0, seconds - reservationCost(entry)), 0);

// All hosted rooms use one Durable Object, so simultaneous starts cannot reserve the same quota.
export class QuotaBudget {
    private display?: { players: number; expiresAt: number; value: QuotaCapacity };
    constructor(private storage: BudgetStorage, private config: QuotaConfig) {}
    async displayCapacity(players = 1) {
        players = playerCount(players);
        if (this.display?.players === players && this.display.expiresAt > Date.now()) return structuredClone(this.display.value);
        const value = await this.capacity(players);
        this.display = { players, expiresAt: Date.now() + (value.quotaMode === 'unavailable' ? 1000 : 5000), value };
        return structuredClone(value);
    }
    private async state() {
        const quota = await fetchGpuQuota(this.config);
        const reservations = await this.storage.get<Record<string, Reservation>>('reservations') || {};
        for (const [code, entry] of Object.entries(reservations)) {
            if (entry.expiresAt < Date.now() || (entry.reset && entry.reset !== quota.resetsAt && Date.parse(entry.reset) <= Date.now())) delete reservations[code];
            else entry.reset = quota.resetsAt;
        }
        return { quota, reservations };
    }
    async capacity(players = 1): Promise<QuotaCapacity> {
        players = playerCount(players);
        if (this.config.AI_PROVIDER === 'mock') return { aiRoundLimit: Number(this.config.AI_ROUND_LIMIT) || 5, playerCount: players, quotaMode: 'mock' };
        try {
            const { quota, reservations } = await this.state();
            const reserved = Object.values(reservations).reduce((sum, entry) => sum + entry.rounds, 0);
            const providers = providerBudgets(this.config);
            const cheapest = [...providers].sort((a, b) => a.gpuSeconds - b.gpuSeconds)[0];
            if (!cheapest) throw new Error('Kein konfigurierter KI-Provider unterstuetzt Videos mit mindestens 5 Sekunden.');
            const availableGenerations = freeGenerations(quota, reservations, cheapest.gpuSeconds);
            return { aiRoundLimit: roundsForPlayers(availableGenerations, players), playerCount: players, availableGenerations, quotaMode: 'live', remainingGpuSeconds: Math.floor(quota.current), reservedRounds: reserved, resetsAt: quota.resetsAt, gpuSecondsPerVideo: cheapest.gpuSeconds, gpuSecondsPerRound: cheapest.gpuSeconds * players, providers, budgetProvider: cheapest.name, sharedQuota: true };
        } catch (error) {
            return { aiRoundLimit: 0, playerCount: players, quotaMode: 'unavailable', error: error instanceof Error ? error.message : 'KI-Kontingent nicht erreichbar.' };
        }
    }
    async reserve(code: string, rounds: number, players = 1) {
        this.display = undefined;
        players = playerCount(players);
        const generations = rounds * players;
        if (!Number.isSafeInteger(rounds) || rounds < 1 || !Number.isSafeInteger(generations)) throw new Error('Ungueltige Rundenzahl.');
        if (this.config.AI_PROVIDER === 'mock') return;
        const { quota, reservations } = await this.state();
        delete reservations[code];
        const seconds = secondsPerRound(this.config);
        if (!Number.isFinite(seconds) || generations > freeGenerations(quota, reservations, seconds)) throw new Error(`Das kostenlose KI-Kontingent reicht nicht fuer ${rounds} Runden mit ${players} Spielern (${generations} Videos). Bitte weniger Runden waehlen.`);
        reservations[code] = { rounds: generations, active: 0, expiresAt: Date.now() + 2 * 60 * 60_000, reset: quota.resetsAt, gpuSecondsPerVideo: seconds };
        await this.storage.put('reservations', reservations);
    }
    async consume(code: string, jobId?: string) {
        this.display = undefined;
        if (this.config.AI_PROVIDER === 'mock') return;
        const reservations = await this.storage.get<Record<string, Reservation>>('reservations') || {};
        if (reservations[code]) {
            const entry = reservations[code];
            const completed = jobId || Object.keys(entry.activeJobs || {})[0];
            if (jobId && entry.activeJobs && !(jobId in entry.activeJobs)) return;
            if (completed && entry.activeJobs) delete entry.activeJobs[completed];
            entry.rounds = Math.max(0, entry.rounds - 1);
            entry.active = Math.max(0, entry.active - 1);
            entry.expiresAt = Date.now() + 2 * 60 * 60_000;
        }
        await this.storage.put('reservations', reservations);
    }
    async extend(code: string, players: number) {
        this.display = undefined;
        players = playerCount(players);
        if (this.config.AI_PROVIDER === 'mock') return;
        const { quota, reservations } = await this.state();
        const entry = reservations[code];
        const seconds = entry?.active ? Math.max(reservationCost(entry), secondsPerRound(this.config)) : secondsPerRound(this.config);
        if (!Number.isFinite(seconds) || freeGenerations(quota, reservations, seconds) < players) throw new Error('Das kostenlose KI-Kontingent reicht nicht fuer eine Zusatzrunde mit allen Spielern.');
        // Preserve abandoned jobs still using GPU time while adding one complete cycle.
        reservations[code] = { ...entry, rounds: (entry?.rounds || 0) + players, active: entry?.active || 0,
            gpuSecondsPerVideo: seconds, expiresAt: Date.now() + 2 * 60 * 60_000, reset: quota.resetsAt };
        await this.storage.put('reservations', reservations);
    }
    async release(code: string) {
        this.display = undefined;
        const reservations = await this.storage.get<Record<string, Reservation>>('reservations') || {};
        if (reservations[code]?.active) reservations[code].rounds = reservations[code].active;
        else delete reservations[code];
        await this.storage.put('reservations', reservations);
    }
    async drop(code: string, generations: number) {
        this.display = undefined;
        if (!Number.isSafeInteger(generations) || generations < 0) throw new Error('Ungueltiges KI-Budget.');
        const reservations = await this.storage.get<Record<string, Reservation>>('reservations') || {};
        const entry = reservations[code];
        if (entry) entry.rounds = Math.max(entry.active, entry.rounds - generations);
        await this.storage.put('reservations', reservations);
    }
    async begin(code: string, requiredGenerations = 1, jobId: string = crypto.randomUUID()) {
        this.display = undefined;
        if (!Number.isSafeInteger(requiredGenerations) || requiredGenerations < 1) throw new Error('Ungueltiges KI-Budget.');
        if (this.config.AI_PROVIDER === 'mock') return;
        const { quota, reservations } = await this.state();
        const entry = reservations[code];
        if (!entry) throw new Error('KI-Budget abgelaufen. Bitte starte ein neues Spiel.');
        if (entry.activeJobs?.[jobId]) throw new Error('Dieser KI-Versuch laeuft bereits.');
        const missing = Math.max(0, requiredGenerations + entry.active - entry.rounds);
        if (missing) {
            if (freeGenerations(quota, reservations, reservationCost(entry)) < missing) throw new Error('Kein kostenloses KI-Budget fuer einen erneuten Versuch vorhanden, ohne spaetere Videos zu gefaehrden.');
            entry.rounds += missing;
        }
        entry.active++;
        entry.activeJobs = { ...entry.activeJobs, [jobId]: reservationCost(entry) };
        await this.storage.put('reservations', reservations);
    }
    async allowAttempt(code: string, seconds: number, jobId?: string) {
        this.display = undefined;
        if (this.config.AI_PROVIDER === 'mock') return;
        const { quota, reservations } = await this.state();
        const current = reservations[code];
        if (!current?.active || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Kein aktiver KI-Versuch reserviert.');
        const jobs = Object.keys(current.activeJobs || {});
        const attempt = jobId || (jobs.length === 1 ? jobs[0] : jobs.length === 0 && current.active === 1 ? 'legacy' : undefined);
        if (!attempt || (jobId && current.activeJobs?.[jobId] === undefined)) throw new Error('KI-Versuch ist nicht mehr reserviert.');
        const protectedRounds = Object.entries(reservations).reduce((sum, [key, entry]) => sum + Math.max(0, entry.rounds - (key === code ? 1 : 0)), 0);
        const ownCost = current.activeJobs?.[attempt] || reservationCost(current);
        const protectedSeconds = Object.entries(reservations).reduce((sum, [key, entry]) => sum + reservationSeconds(entry) - (key === code ? ownCost : 0), 0);
        if (quota.current - protectedSeconds < seconds || (quota.runs && quota.runs.remaining - protectedRounds < 1)) throw new Error('Das kostenlose Kontingent reicht nicht fuer diesen KI-Versuch.');
        // Hold quality upgrades until completion, including before HF charges queued jobs.
        current.activeJobs = { ...current.activeJobs, [attempt]: Math.max(ownCost, seconds) };
        await this.storage.put('reservations', reservations);
    }
}
