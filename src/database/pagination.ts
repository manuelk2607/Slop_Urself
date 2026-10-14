import type { RoomStats, VideoStats } from './types';

export interface HistoryPage<T> { items: T[]; nextCursor: string | null }
export interface HistoryCursor { at: string; id: string }
export const VIDEO_PAGE_SIZE = 12;
export const ROOM_PAGE_SIZE = 50;

export function historyCursor(value: string | null, kind: 'videos' | 'rooms'): HistoryCursor | undefined {
    if (value === null) return;
    try {
        if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
        const cursor = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))) as HistoryCursor;
        if (typeof cursor.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at))) throw new Error();
        if (typeof cursor.id !== 'string' || (kind === 'rooms' ? !/^[A-Z0-9]{4}$/.test(cursor.id)
            : !/^[1-9]\d{0,18}$/.test(cursor.id) || BigInt(cursor.id) > 9223372036854775807n)) throw new Error();
        return { at: cursor.at, id: cursor.id };
    } catch { throw new Error('Ungültige Historienseite. Bitte lade die Statistik erneut.'); }
}

export function historyPage<T extends VideoStats | RoomStats>(rows: T[], size: number): HistoryPage<T> {
    const items = rows.slice(0, size), last = items.at(-1);
    const nextCursor = rows.length > size && last ? btoa(JSON.stringify({ at: last.createdAt,
        id: 'id' in last ? last.id : last.code })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') : null;
    return { items, nextCursor };
}
