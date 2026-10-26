import { archivedVideoPath } from '../security/reports';
interface Storage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }
interface Lease { url: string; expiresAt: number }
export const ARCHIVE_LEASE_MS = 2 * 60 * 60_000;

// Operations run in the same archive queue as listing/eviction. A published
// object is reserved before its URL is returned to the room.
export class ArchiveReservations {
    constructor(private storage: Storage) {}
    private async current(now: number) {
        const values = await this.storage.get<Record<string, Lease>>('archive-leases') || {};
        return Object.fromEntries(Object.entries(values).filter(([, entry]) => entry.expiresAt > now));
    }
    async protect(code: string, url: string, now = Date.now()) {
        if (!/^[A-Z0-9]{4}$/.test(code) || !archivedVideoPath(url)) throw new Error('Ungültige Archivreservierung.');
        const leases = await this.current(now);
        if (!leases[code] && Object.keys(leases).length >= 512) throw new Error('Zu viele aktive Archivreservierungen.');
        const current = leases[code];
        if (current?.url === url && current.expiresAt > now + ARCHIVE_LEASE_MS / 2) return;
        leases[code] = { url, expiresAt: now + ARCHIVE_LEASE_MS };
        await this.storage.put('archive-leases', leases);
    }
    async activeUrls(now = Date.now()) { return Object.values(await this.current(now)).map(entry => entry.url); }
}
