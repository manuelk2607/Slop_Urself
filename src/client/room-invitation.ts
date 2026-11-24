const key = 'slopurself-worlds-invitation';
const lifetime = 15 * 60_000;

export function roomInvitation(search: string) {
    const code = new URLSearchParams(search).get('room')?.toUpperCase() ?? '';
    return code.length === 4 && /^[A-Z0-9]{4}$/.test(code) ? code : '';
}

export function rememberWorldsInvitation(storage: Pick<Storage, 'setItem'>, search: string, now = Date.now()) {
    const code = roomInvitation(search);
    if (code) storage.setItem(key, `${now}:${code}`);
}

export function takeWorldsInvitation(storage: Pick<Storage, 'getItem' | 'removeItem'>, now = Date.now()) {
    const saved = storage.getItem(key);
    if (!saved) return '';
    storage.removeItem(key);
    const [stamp, code, extra] = saved.split(':');
    const savedAt = Number(stamp);
    return !!stamp && Number.isSafeInteger(savedAt) && savedAt <= now && now - savedAt < lifetime &&
        code?.length === 4 && /^[A-Z0-9]{4}$/.test(code) && extra === undefined ? code : '';
}
