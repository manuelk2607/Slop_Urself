interface UndoVideo { url: string; undoUntil: number }
const STORAGE_KEY = 'slopurself-video-undo';

export function historyUndo(refresh: () => Promise<void>) {
    const notice = document.getElementById('videoUndoNotice')!;
    const label = document.getElementById('videoUndoLabel')!;
    const button = document.getElementById('undoVideoDeletion') as HTMLButtonElement;
    const error = document.getElementById('statsActionNotice')!;
    const pending = new Map<string, UndoVideo>();
    let busy = false;
    let timer: number | undefined;
    try {
        const saved: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
        if (Array.isArray(saved)) for (const item of saved) {
            if (item && /^\/api\/stats\/videos\/[1-9]\d*$/.test(item.url) && Number.isFinite(item.undoUntil)) pending.set(item.url, item);
        }
    } catch { /* Private browsing may disable storage. Undo still works until reload. */ }
    function update() {
        for (const [url, item] of pending) if (item.undoUntil <= Date.now()) pending.delete(url);
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...pending.values()])); } catch { /* Optional reload support. */ }
        notice.hidden = pending.size === 0;
        button.disabled = busy || pending.size === 0;
        if (pending.size) {
            const seconds = Math.max(1, Math.ceil((Math.min(...[...pending.values()].map(item => item.undoUntil)) - Date.now()) / 1000));
            label.textContent = `${pending.size} ${pending.size === 1 ? 'Video gelöscht' : 'Videos gelöscht'} · ${seconds} s`;
            timer ??= window.setInterval(update, 1000);
        } else { window.clearInterval(timer); timer = undefined; }
    }
    function remember(items: UndoVideo[]) { items.forEach(item => pending.set(item.url, item)); update(); }
    button.addEventListener('click', async () => {
        if (busy) return;
        busy = true; update(); error.hidden = true;
        const reasons = new Set<string>();
        try {
            for (const item of [...pending.values()]) {
                try {
                    const response = await fetch(`${item.url}/restore`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
                    const data = await response.json() as { error?: string };
                    if (response.ok || response.status === 404 || response.status === 410) pending.delete(item.url);
                    if (!response.ok) throw new Error(data.error || 'Das Video konnte nicht wiederhergestellt werden.');
                } catch (reason) { reasons.add(reason instanceof Error ? reason.message : 'Wiederherstellen fehlgeschlagen.'); }
            }
            await refresh();
            if (reasons.size) { error.textContent = [...reasons].join(' '); error.hidden = false; }
        } finally { busy = false; update(); }
    });
    update();
    return { remember };
}
