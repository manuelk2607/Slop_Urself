interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface Draft { text: string; expiresAt: number }
export const PROMPT_DRAFT_TTL_MS = 15 * 60_000;
const KEY = 'slopurself-prompt-drafts';

// Tab-local text only. Never persist images, HF credentials or server sessions.
export function promptDrafts(storage: () => DraftStorage) {
    function read(now: number): Record<string, Draft> {
        const raw = storage().getItem(KEY);
        if (!raw || raw.length > 32_768) return {};
        let entries: unknown;
        try { entries = JSON.parse(raw); } catch { storage().removeItem(KEY); return {}; }
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
        return Object.fromEntries(Object.entries(entries).filter(([scope, value]: [string, Draft]) => scope.length <= 256 && value
            && typeof value.text === 'string' && value.text.length <= 150 && Number.isFinite(value.expiresAt)
            && value.expiresAt > now && value.expiresAt <= now + PROMPT_DRAFT_TTL_MS));
    }
    function write(entries: Record<string, Draft>) {
        const bounded = Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].expiresAt - a[1].expiresAt).slice(0, 10));
        if (Object.keys(bounded).length) storage().setItem(KEY, JSON.stringify(bounded));
        else storage().removeItem(KEY);
    }
    return {
        get(scope: string, now = Date.now()) {
            try { const entries = read(now); write(entries); return entries[scope]?.text || ''; } catch { return ''; }
        },
        save(scope: string, text: string, now = Date.now()) {
            try {
                if (!scope || scope.length > 256 || text.length > 150) return;
                const entries = read(now);
                if (text) entries[scope] = { text, expiresAt: now + PROMPT_DRAFT_TTL_MS };
                else delete entries[scope];
                write(entries);
            } catch { /* Storage restrictions must not prevent playing. */ }
        },
        remove(scope: string) { this.save(scope, ''); },
        clear() { try { storage().removeItem(KEY); } catch { /* No retained draft in unavailable storage. */ } }
    };
}
