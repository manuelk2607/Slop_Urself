export interface ModerationCheckpoint { digest: string; id?: string; expiresAt: number }
export interface ModerationJournal {
    load(key: string): Promise<ModerationCheckpoint | undefined>;
    save(key: string, value: ModerationCheckpoint): Promise<void>;
    clear(key: string): Promise<void>;
}
interface Storage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }
// Callers serialize mutations in the Services archive queue. No images, prompts,
// tokens, upstream URLs or moderation verdicts are persisted here.
export class StoredModerationJournal implements ModerationJournal {
    constructor(private storage: Storage) {}
    private async entries() {
        const entries = await this.storage.get<Record<string, ModerationCheckpoint>>('moderation-checkpoints') || {};
        return Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry.expiresAt > Date.now()));
    }
    async load(key: string) { return (await this.entries())[key]; }
    async save(key: string, value: ModerationCheckpoint) {
        if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(value.digest)
            || (value.id !== undefined && !/^[a-f0-9-]{36}$/.test(value.id))
            || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 360_000) throw new Error('Invalid moderation checkpoint');
        const entries = await this.entries();
        if (!entries[key] && Object.keys(entries).length >= 64) throw new Error('Moderation capacity');
        entries[key] = value; await this.storage.put('moderation-checkpoints', entries);
    }
    async clear(key: string) { const entries = await this.entries(); delete entries[key]; await this.storage.put('moderation-checkpoints', entries); }
    async cleanup() { await this.storage.put('moderation-checkpoints', await this.entries()); }
}
