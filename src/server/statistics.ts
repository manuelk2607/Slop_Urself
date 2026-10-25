import { requestAccount, authFailureStatus, authDisabled, type Account, type AuthConfig } from '../auth/session';
import type { GameRepository } from '../database/repository';
import type { SavedVideo } from '../database/types';
import { historyCursor } from '../database/pagination';
import { restoreIds, type RestoreResult } from '../shared/history';
import { boundedJson } from './body';

export async function restoreHistoryResponse(request: Request, config: AuthConfig, restore: (ids: string[]) => Promise<RestoreResult[]>,
    authorize?: (ids: string[], account: Account) => Promise<string[]>) {
    if (request.method !== 'POST') return historyJson({}, 405);
    if (request.headers.get('origin') !== new URL(request.url).origin) return historyJson({ error: 'Ungültiger Ursprung.' }, 403);
    let account;
    try { account = await requestAccount(request, config); } catch (error) { return historyJson({ error: 'Bitte melde dich erneut an.' }, authFailureStatus(error)); }
    let ids: string[];
    try { const data = await boundedJson(request, 8192) as { ids?: unknown }; ids = restoreIds(data?.ids); }
    catch (error) { return historyJson({ error: error instanceof Error ? error.message : 'Ungültige Anfrage.' }, error instanceof RangeError ? 413 : 400); }
    try {
        const allowed = authDisabled(config) ? ids : account && authorize ? await authorize(ids, account) : [];
        const results = new Map((allowed.length ? await restore(allowed) : []).map(r => [r.id, r]));
        return historyJson({ results: ids.map(id => results.get(id) || { id, status: 'forbidden' }) });
    }
    catch { return historyJson({ error: 'Wiederherstellen ist gerade nicht erreichbar. Bitte versuche es vor Ablauf der Frist erneut.' }, 503); }
}

export interface HistoryDeletion { code: string; roundNumber?: number; videoId?: string; restore?: boolean }
export const VIDEO_UNDO_SECONDS = 30;
export interface HistoryResult { undoUntil?: number }
export class HistoryError extends Error {
    constructor(message: string, public status = 503) { super(message); }
}
export const historyJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export async function historyListing(request: Request, config: AuthConfig, database: GameRepository | null) {
    if (request.method !== 'GET') return historyJson({ error: 'Diese Aktion ist nicht verfügbar.' }, 405);
    let account;
    try { account = await requestAccount(request, config); } catch (error) { return historyJson({ error: 'Bitte melde dich erneut an.' }, authFailureStatus(error)); }
    const url = new URL(request.url), kind = url.pathname === '/api/stats/videos' ? 'videos' : 'rooms';
    let cursor;
    try { cursor = historyCursor(url.searchParams.get('cursor'), kind); }
    catch (error) { return historyJson({ error: (error as Error).message }, 400); }
    if (!database) return historyJson({ error: 'Die Statistik-Datenbank ist nicht eingerichtet.' }, 503);
    try {
        const viewer = historyViewer(account, config);
        return historyJson(kind === 'videos' ? await database.videoPage(url.searchParams.get('player')?.slice(0, 100), cursor, viewer) : await database.roomPage(cursor, viewer));
    }
    catch { return historyJson({ error: 'Die Historie konnte nicht geladen werden.' }, 503); }
}

export async function historyResponse(request: Request, config: AuthConfig,
    remove: (command: HistoryDeletion) => Promise<HistoryResult | void>,
    findVideo?: (id: string) => Promise<SavedVideo | undefined>,
    authorize?: (command: HistoryDeletion, account: Account) => Promise<boolean>) {
    const path = new URL(request.url).pathname;
    const videoMatch = /^\/api\/stats\/videos\/([1-9]\d{0,18})(\/restore)?$/.exec(path);
    const restore = Boolean(videoMatch?.[2]);
    if (request.method !== (restore ? 'POST' : 'DELETE')) return historyJson({ error: 'Diese Aktion ist nicht verfügbar.' }, 405);
    if (request.headers.get('origin') !== new URL(request.url).origin) return historyJson({ error: 'Ungültige Anfrage.' }, 403);
    let account;
    try { account = await requestAccount(request, config); } catch (error) { return historyJson({ error: authFailureStatus(error) === 503 ? 'Deine Browsersitzung ist gerade nicht erreichbar.' : 'Bitte melde dich an.' }, authFailureStatus(error)); }
    const match = /^\/api\/stats\/rooms\/([A-Z0-9]{4})(?:\/videos\/(\d+))?$/.exec(path);
    if ((!videoMatch && !match) || (videoMatch && BigInt(videoMatch[1]) > 9223372036854775807n)
        || (match?.[2] && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1))) return historyJson({ error: 'Ungültiger Statistik-Eintrag.' }, 400);
    try {
        let command: HistoryDeletion;
        if (videoMatch) {
            if (!findVideo) throw new HistoryError('Die Video-Historie ist gerade nicht erreichbar.');
            const video = await findVideo(videoMatch[1]);
            if (!video) throw new HistoryError('Dieses Video wurde bereits gelöscht.', 404);
            command = { code: video.roomCode, roundNumber: video.roundNumber, videoId: video.id, restore };
        } else command = { code: match![1], roundNumber: match![2] ? Number(match![2]) : undefined };
        if (!authDisabled(config) && (!account || !authorize || !await authorize(command, account))) throw new HistoryError('Du darfst nur eigene Einträge löschen oder wiederherstellen.', 403);
        const result = await remove(command);
        return historyJson({ ok: true, ...result });
    } catch (error) {
        return historyJson({ error: error instanceof Error ? error.message : 'Der Eintrag konnte nicht gelöscht werden.' }, error instanceof HistoryError ? error.status : 503);
    }
}

export const historyViewer = (account: Account | undefined, config: AuthConfig) => authDisabled(config) || account?.id === config.ADMIN_ACCOUNT_ID ? undefined : account?.id;
export async function authorizeHistory(database: GameRepository | null, command: HistoryDeletion, account: Account, config: AuthConfig) {
    if (account.id === config.ADMIN_ACCOUNT_ID) return true;
    if (!database) return false;
    if (command.roundNumber || command.videoId) return (await historyVideo(database, command))?.creatorId === account.id;
    return database.canManageRoom(command.code, account.id);
}
export async function authorizeRestore(database: GameRepository | null, ids: string[], account: Account, config: AuthConfig) {
    return account.id === config.ADMIN_ACCOUNT_ID ? ids : await database?.ownedVideoIds(ids, account.id) || [];
}

export async function historyVideo(database: GameRepository | null, command: HistoryDeletion) {
    if (!database) throw new HistoryError('Die Statistik-Datenbank ist nicht eingerichtet.');
    if (!command.roundNumber && !command.videoId) return undefined;
    const video = command.videoId ? await database.savedVideo(command.videoId) : (await database.historyVideos(command.code, command.roundNumber))[0];
    if (!video) throw new HistoryError('Dieses Video wurde bereits gelöscht.', 404);
    if (video.roomCode !== command.code || (command.roundNumber && video.roundNumber !== command.roundNumber)) throw new HistoryError('Ungültiges Video.', 400);
    return video;
}

export async function deleteStoredHistory(database: GameRepository | null, command: HistoryDeletion, schedule: (time: number) => Promise<void>): Promise<HistoryResult> {
    if (!database) throw new HistoryError('Die Statistik-Datenbank ist nicht eingerichtet.');
    if (command.roundNumber || command.videoId) {
        const video = await historyVideo(database, command);
        if (command.restore) {
            if (!await database.restoreVideo(video!.id)) throw new HistoryError('Die Frist zum Rückgängigmachen ist abgelaufen.', 410);
            return {};
        }
        // Arm cleanup before the database write so an accepted deletion always has a wake-up.
        await schedule(Date.now() + VIDEO_UNDO_SECONDS * 1000);
        const result = await database.trashVideo(video!.id, VIDEO_UNDO_SECONDS);
        if (!result) throw new HistoryError('Die Frist zum Rückgängigmachen ist abgelaufen.', 410);
        return result;
    }
    if (!await database.roomExists(command.code)) throw new HistoryError('Dieser Raum wurde bereits gelöscht.', 404);
    await database.deleteRoom(command.code);
    return {};
}

export async function purgeDeletedVideos(database: GameRepository | null, removeFile: (url: string) => Promise<void>) {
    if (!database) return;
    let failed = false;
    for (const video of await database.expiredVideos()) {
        try { await removeFile(video.videoUrl); await database.finalizeVideoDeletion(video.id); }
        catch { failed = true; }
    }
    if (failed) throw new HistoryError('Einige Videodateien konnten noch nicht endgültig gelöscht werden.');
}
