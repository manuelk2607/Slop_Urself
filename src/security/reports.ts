export const REPORT_REASONS = ['sexual_exploitation', 'nonconsensual', 'graphic_abuse', 'other'] as const;
export type ReportReason = typeof REPORT_REASONS[number];
export const archivedVideoPath = (url: unknown): url is string => typeof url === 'string' && /^\/api\/videos\/videos\/\d{13}-[a-z0-9-]+\.mp4$/.test(url) && url.length < 250;
export interface ContentReport { id: string; url: string; reporterId: string; reason: ReportReason; createdAt: number }
interface ReportStorage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }

// Independent of archive deletion/undo: restoring an object never lifts a ban.
// No raw media, prompts or access tokens are retained in this registry.
export class ContentReports {
    private operations: Promise<unknown> = Promise.resolve();
    constructor(private storage: ReportStorage) {}
    private serial<T>(work: () => Promise<T>) {
        const result = this.operations.then(work); this.operations = result.catch(() => {}); return result;
    }
    async blocked(url: string) {
        if (!archivedVideoPath(url)) throw new Error('Ungültiges Video.');
        return Boolean(await this.storage.get(`content-ban:${url}`));
    }
    async allowed(urls: string[]) {
        if (!Array.isArray(urls) || urls.length > 200 || urls.some(url => !archivedVideoPath(url))) throw new Error('Ungültige Videoauswahl.');
        const results = await Promise.all(urls.map(async url => await this.blocked(url) ? undefined : url));
        return results.filter((url): url is string => Boolean(url));
    }
    async list() {
        const reports = await this.storage.get<ContentReport[]>('content-reports') || [];
        return Promise.all(reports.filter(r => r.createdAt > Date.now() - 30 * 86400_000).map(async r => ({ ...r, blocked: await this.blocked(r.url) })));
    }
    report(url: string, reporterId: string, reason: ReportReason) {
        return this.serial(async () => {
            if (!archivedVideoPath(url) || !reporterId || reporterId.length > 100 || !REPORT_REASONS.includes(reason)) throw new Error('Ungültige Meldung.');
            const now = Date.now();
            const reports = (await this.storage.get<ContentReport[]>('content-reports') || []).filter(r => r.createdAt > now - 30 * 86400_000);
            if (reports.some(r => r.url === url && r.reporterId === reporterId)) return;
            if (reports.filter(r => r.reporterId === reporterId && r.createdAt > now - 3600_000).length >= 6 || reports.length >= 500) throw new Error('Das Meldelimit ist erreicht. Bitte versuche es später erneut.');
            reports.push({ id: crypto.randomUUID(), url, reporterId, reason, createdAt: now });
            await this.storage.put('content-reports', reports);
        });
    }
    block(url: string, moderatorId: string) {
        return this.serial(async () => {
            if (!archivedVideoPath(url) || !moderatorId) throw new Error('Ungültige Sperre.');
            await this.storage.put(`content-ban:${url}`, { at: Date.now(), moderatorId });
        });
    }
}
