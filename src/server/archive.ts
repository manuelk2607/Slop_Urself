import type { GameRepository } from '../database/repository';
import { archiveEnabled, archiveLimit, listArchive, type ArchiveConfig } from '../storage/archive';

export async function archiveStatus(config: ArchiveConfig, database: GameRepository | null) {
    const enabled = archiveEnabled(config);
    const objects = await listArchive(config);
    if (enabled) await database?.reconcileArchive(objects.map(object => `/api/videos/${object.key}`));
    return { enabled, usedBytes: objects.reduce((sum, object) => sum + object.size, 0),
        maxBytes: archiveLimit(config), videoCount: objects.length };
}

type ArchiveStatus = Awaited<ReturnType<typeof archiveStatus>>;
export const ARCHIVE_STATUS_TTL_MS = 5_000;

// Only the display inventory is cached. Capacity/eviction always list storage
// freshly. Use the archive queue for reads and mutations, invalidating before
// each physical mutation (including ambiguous/failed uploads and deletions).
export class ArchiveStatusCache {
    private version = 0;
    private cached?: { value: ArchiveStatus; database: GameRepository | null; until: number };
    private pending?: { database: GameRepository | null; version: number; result: Promise<ArchiveStatus> };
    constructor(private config: ArchiveConfig) {}
    invalidate() { this.version++; this.cached = undefined; }
    async read(database: GameRepository | null, now = Date.now()): Promise<ArchiveStatus> {
        if (this.cached?.database === database && this.cached.until > now) return { ...this.cached.value };
        if (this.pending?.database === database && this.pending.version === this.version) return { ...await this.pending.result };
        const version = this.version;
        const result = (async () => {
            const objects = await listArchive(this.config);
            if (version !== this.version) throw new Error('Der Archivbestand hat sich während des Abrufs geändert.');
            const enabled = archiveEnabled(this.config);
            // Never reconcile from a stale cached list or an incomplete/error response.
            if (enabled) await database?.reconcileArchive(objects.map(object => `/api/videos/${object.key}`));
            const value = { enabled, usedBytes: objects.reduce((sum, object) => sum + object.size, 0), maxBytes: archiveLimit(this.config), videoCount: objects.length };
            if (version === this.version) this.cached = { value, database, until: now + ARCHIVE_STATUS_TTL_MS };
            return value;
        })();
        this.pending = { database, version, result };
        try { return { ...await result }; }
        finally { if (this.pending?.result === result) this.pending = undefined; }
    }
}
