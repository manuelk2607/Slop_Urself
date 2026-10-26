import { archivedVideoPath } from '../security/reports';
import { archiveEnabled, archiveLimit, evictionPlan, listArchive, MAX_VIDEO_BYTES, type ArchiveConfig } from './archive';
interface Storage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }
interface Lease { url: string; expiresAt: number }
interface Pending { code: string; bytes: number; expiresAt: number }
export const ARCHIVE_LEASE_MS = 2 * 60 * 60_000;
export const ARCHIVE_JOB_HOLD_MS = 30 * 60_000;

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
    private async pending(now: number) {
        const values = await this.storage.get<Record<string, Pending>>('archive-pending') || {};
        return Object.fromEntries(Object.entries(values).filter(([, entry]) => entry.expiresAt > now));
    }
    async pendingBytes(exceptJob?: string, now = Date.now()) {
        return Object.entries(await this.pending(now)).reduce((sum, [id, entry]) => sum + (id === exceptJob ? 0 : entry.bytes), 0);
    }
    async reserve(jobId: string, code: string, config: ArchiveConfig, protectedUrls: string[] = [], now = Date.now()) {
        if (!/^[a-f0-9-]{36}$/.test(jobId) || !/^[A-Z0-9]{4}$/.test(code)) throw new Error('Ungültiger Speicherauftrag.');
        if (!archiveEnabled(config)) throw new Error('Der Videospeicher ist nicht eingerichtet.');
        const pending = await this.pending(now);
        if (pending[jobId] && pending[jobId].code !== code) throw new Error('Speicherauftrag gehört zu einem anderen Raum.');
        if (!pending[jobId] && Object.keys(pending).length >= 512) throw new Error('Zu viele laufende Speicheraufträge.');
        const protectedKeys = new Set([...protectedUrls, ...await this.activeUrls(now)].map(url => url.slice('/api/videos/'.length)));
        const otherBytes = Object.entries(pending).reduce((sum, [id, entry]) => sum + (id === jobId ? 0 : entry.bytes), 0);
        // Plan only: do not delete old clips for a generation that might fail.
        evictionPlan(await listArchive(config), MAX_VIDEO_BYTES + otherBytes, archiveLimit(config), protectedKeys);
        pending[jobId] = { code, bytes: MAX_VIDEO_BYTES, expiresAt: now + ARCHIVE_JOB_HOLD_MS };
        await this.storage.put('archive-pending', pending);
    }
    async release(jobId: string, now = Date.now()) {
        const pending = await this.pending(now);
        if (Object.hasOwn(pending, jobId)) { delete pending[jobId]; await this.storage.put('archive-pending', pending); }
    }
}
