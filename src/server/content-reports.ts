import { requestAccount, authFailureStatus, type Account, type AuthConfig } from '../auth/session';
import { archivedVideoPath, REPORT_REASONS, type ContentReport, type ReportReason } from '../security/reports';
import { boundedJson } from './body';
import { unlocked } from './accounts';
import { historyJson } from './statistics';

export interface ReportActions {
    list(): Promise<(ContentReport & { blocked: boolean })[]>;
    report(url: string, accountId: string, reason: ReportReason): Promise<void>;
    block(url: string, accountId: string): Promise<void>;
}
export async function contentReportResponse(request: Request, config: AuthConfig, actions: ReportActions, canRead: (url: string, account: Account) => Promise<boolean>) {
    const path = new URL(request.url).pathname;
    const admin = path.startsWith('/api/admin/');
    const listing = path === '/api/admin/moderation' && request.method === 'GET';
    const blocking = path === '/api/admin/moderation/block' && request.method === 'POST';
    const reporting = path === '/api/moderation/reports' && request.method === 'POST';
    if (!listing && !blocking && !reporting) return historyJson({}, 405);
    if (!listing && request.headers.get('origin') !== new URL(request.url).origin) return historyJson({ error: 'Ungültiger Ursprung.' }, 403);
    try {
        let account: Account | undefined;
        try { account = await requestAccount(request, config); }
        catch (error) { return historyJson({ error: 'Bitte melde dich erneut an.' }, authFailureStatus(error)); }
        if (!account) return historyJson({}, 401);
        if (admin && !await unlocked(request, config, account)) return historyJson({ error: 'Bitte schalte zuerst die Verwaltung frei.' }, 403);
        if (listing) return historyJson({ reports: await actions.list() });
        const data = await boundedJson(request, 1024) as { url?: unknown; reason?: unknown; confirmation?: unknown } | null;
        if (!data || !archivedVideoPath(data.url)) return historyJson({ error: 'Ungültiges Video.' }, 422);
        if (blocking) {
            if (data.confirmation !== data.url) return historyJson({ error: 'Die Bestätigung stimmt nicht überein.' }, 409);
            await actions.block(data.url, account.id);
        } else {
            if (typeof data.reason !== 'string' || !REPORT_REASONS.includes(data.reason as ReportReason)) return historyJson({ error: 'Bitte wähle einen Meldegrund.' }, 422);
            if (!await canRead(data.url, account)) return historyJson({ error: 'Kein Zugriff auf dieses Video.' }, 403);
            await actions.report(data.url, account.id, data.reason as ReportReason);
        }
        return historyJson({ ok: true });
    } catch (error) { return historyJson({ error: error instanceof RangeError ? 'Die Anfrage ist zu groß.' : 'Die Inhaltsverwaltung ist gerade nicht erreichbar.' }, error instanceof RangeError ? 413 : 503); }
}
