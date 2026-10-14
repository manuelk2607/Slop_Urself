interface Account { id: string; name: string }
interface AuthUI {
    signedIn(name: string): Promise<void>;
    signedOut(): Promise<void>;
    showAuth(): void;
    refreshToken(token: string): void;
}
let refresh: (() => Promise<void>) | undefined;
class SessionError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function refreshAccount() { await refresh?.(); }

export async function initializeAccount(ui: AuthUI) {
    const form = document.getElementById('authForm') as HTMLFormElement;
    const username = document.getElementById('authUsername') as HTMLInputElement;
    const submit = document.getElementById('authSubmit') as HTMLButtonElement;
    const existing = document.getElementById('existingNameButton') as HTMLButtonElement;
    const submitLabel = submit.innerText;
    const existingLabel = existing.innerText;
    const error = document.getElementById('authError')!;
    const bar = document.getElementById('accountBar')!;
    let ready = false;
    let pending: Promise<void> | undefined;
    async function session(mode: 'create' | 'login' | 'refresh') {
        const response = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: username.value, mode }), signal: AbortSignal.timeout(15_000) });
        const result = await response.json() as { account?: Account; token?: string; error?: string };
        if (!response.ok || !result.account || !result.token) throw new SessionError(result.error || `${mode === 'create' ? 'Die Registrierung' : 'Die Anmeldung'} ist gerade nicht erreichbar.`, response.status);
        ui.refreshToken(result.token);
        return result.account;
    }
    async function signedIn(account: Account) {
        ready = true; bar.hidden = false;
        document.getElementById('accountName')!.innerText = account.name;
        username.value = account.name;
        await ui.signedIn(account.name);
    }
    async function enter(mode: 'create' | 'login') {
        if (!form.reportValidity() || submit.disabled) return;
        submit.disabled = existing.disabled = true; error.innerText = '';
        form.setAttribute('aria-busy', 'true');
        if (mode === 'create') submit.innerText = 'Benutzer wird erstellt...';
        else existing.innerText = 'Anmeldung l\u00e4uft...';
        try { await signedIn(await session(mode)); }
        catch (reason) { error.innerText = reason instanceof Error ? reason.message : `${mode === 'create' ? 'Die Registrierung' : 'Die Anmeldung'} ist gerade nicht erreichbar.`; }
        finally {
            submit.disabled = existing.disabled = false;
            submit.innerText = submitLabel; existing.innerText = existingLabel;
            form.removeAttribute('aria-busy');
        }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void enter('create'); });
    existing.addEventListener('click', () => { void enter('login'); });
    refresh = async () => {
        if (!ready) return;
        if (!pending) pending = session('refresh').then(() => {}).catch(async reason => {
            if (reason instanceof SessionError && reason.status === 401) {
                ready = false; await ui.signedOut(); bar.hidden = true; ui.showAuth(); error.innerText = reason.message;
            }
        }).finally(() => { pending = undefined; });
        await pending;
    };
    document.getElementById('signOutButton')!.addEventListener('click', async () => {
        ready = false; await pending;
        try {
            await ui.signedOut();
            const response = await fetch('/api/session', { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
            if (!response.ok) throw new Error('Abmelden ist gerade nicht erreichbar.');
            bar.hidden = true; ui.showAuth();
        } catch (reason) { error.innerText = reason instanceof Error ? reason.message : 'Abmelden ist gerade nicht erreichbar.'; ui.showAuth(); }
    });
    window.setInterval(() => { void refreshAccount(); }, 5 * 60_000);
    try {
        if (location.protocol === 'file:') throw new Error('Bitte öffne das Spiel über den Server oder den Cloudflare-Link.');
        const response = await fetch('/api/config', { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('Spielkonfiguration nicht erreichbar.');
        const config = await response.json() as { authEnabled: boolean };
        if (!config.authEnabled) { await ui.signedIn(''); return; }
        const saved = await fetch('/api/session', { signal: AbortSignal.timeout(10_000) });
        if (saved.ok) {
            const { account } = await saved.json() as { account?: Account };
            if (account) { await signedIn(account); return; }
        } else if (saved.status !== 401) throw new Error('Deine Browsersitzung ist gerade nicht erreichbar.');
        ui.showAuth();
    } catch (reason) { ui.showAuth(); error.innerText = reason instanceof Error ? reason.message : 'Der Einstieg ist gerade nicht erreichbar.'; }
}
