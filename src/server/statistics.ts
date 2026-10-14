import { requestAccount, authFailureStatus, type AuthConfig } from '../auth/session';
import type { GameRepository } from '../database/repository';
import type { SavedVideo } from '../database/types';

export interface HistoryDeletion { code: string; roundNumber?: number; videoId?: string; restore?: boolean }
export const VIDEO_UNDO_SECONDS = 30;
export interface HistoryResult { undoUntil?: number }
export class HistoryError extends Error {
    constructor(message: string, public status = 503) { super(message); }
}
export const historyJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export async function historyResponse(request: Request, config: AuthConfig,
    remove: (command: HistoryDeletion) => Promise<HistoryResult | void>,
    findVideo?: (id: string) => Promise<SavedVideo | undefined>) {
    const path = new URL(request.url).pathname;
    const videoMatch = /^\/api\/stats\/videos\/([1-9]\d{0,18})(\/restore)?$/.exec(path);
    const restore = Boolean(videoMatch?.[2]);
    if (request.method !== (restore ? 'POST' : 'DELETE')) return historyJson({ error: 'Diese Aktion ist nicht verfügbar.' }, 405);
    if (request.headers.get('origin') !== new URL(request.url).origin) return historyJson({ error: 'Ungültige Anfrage.' }, 403);
    try { await requestAccount(request, config); } catch (error) { return historyJson({ error: authFailureStatus(error) === 503 ? 'Deine Browsersitzung ist gerade nicht erreichbar.' : 'Bitte melde dich an.' }, authFailureStatus(error)); }
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
        const result = await remove(command);
        return historyJson({ ok: true, ...result });
    } catch (error) {
        return historyJson({ error: error instanceof Error ? error.message : 'Der Eintrag konnte nicht gelöscht werden.' }, error instanceof HistoryError ? error.status : 503);
    }
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
