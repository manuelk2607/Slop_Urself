import { createElement, Link2, X } from 'lucide';

interface Connection { configured?: boolean; connected?: boolean; username?: string; remainingSeconds?: number; totalSeconds?: number; error?: string }
export function huggingFaceConnection() {
    const open = document.getElementById('hfAccountButton') as HTMLButtonElement;
    const dialog = document.getElementById('hfDialog') as HTMLDialogElement;
    const close = document.getElementById('hfCloseButton') as HTMLButtonElement;
    const connect = document.getElementById('hfConnectButton') as HTMLButtonElement;
    const disconnect = document.getElementById('hfDisconnectButton') as HTMLButtonElement;
    const status = document.getElementById('hfStatus')!;
    const error = document.getElementById('hfError')!;
    open.prepend(createElement(Link2, { width: 16, height: 16, 'aria-hidden': 'true' }));
    close.replaceChildren(createElement(X, { width: 20, height: 20, 'aria-hidden': 'true' }));
    let locked = false, pending = false;
    async function load() {
        connect.disabled = disconnect.disabled = true; error.textContent = '';
        status.textContent = 'HF-Verbindung wird geprüft …';
        try {
            const response = await fetch('/api/hf', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new Error('HF-Verbindung ist gerade nicht erreichbar.');
            const data = await response.json() as Connection;
            status.textContent = data.connected ? `${data.username} · ${data.remainingSeconds} / ${data.totalSeconds} GPU-Sekunden`
                : data.configured ? 'Gemeinsames KI-Kontingent' : 'Die HF-Anmeldung ist auf diesem Server noch nicht eingerichtet.';
            connect.textContent = data.connected ? 'HF-Verbindung erneuern' : 'Hugging Face verbinden';
            connect.disabled = locked || !data.configured;
            disconnect.hidden = !data.connected; disconnect.disabled = locked;
            if (data.error) error.textContent = data.error;
        } catch (reason) { error.textContent = (reason as Error).message; }
    }
    open.addEventListener('click', () => { dialog.showModal(); void load(); });
    close.addEventListener('click', () => dialog.close());
    connect.addEventListener('click', async () => {
        if (locked || pending) return;
        const authorizationTab = window.open('', '_blank', 'popup');
        if (authorizationTab) {
            authorizationTab.opener = null;
            authorizationTab.document.title = 'Hugging Face wird geöffnet';
            authorizationTab.document.body.textContent = 'Hugging Face wird geöffnet …';
        }
        pending = true; connect.disabled = disconnect.disabled = true; error.textContent = '';
        try {
            const response = await fetch('/api/hf/connect', { method: 'POST', signal: AbortSignal.timeout(15_000) });
            const result = await response.json() as { url?: string; error?: string };
            if (!response.ok || !result.url) throw new Error(result.error || 'HF-Anmeldung konnte nicht gestartet werden.');
            const target = new URL(result.url);
            if (target.origin !== 'https://huggingface.co' || target.pathname !== '/oauth/authorize') throw new Error('Ungültige HF-Anmeldeadresse.');
            if (authorizationTab && !authorizationTab.closed) {
                authorizationTab.location.replace(target.href);
                // HF can transiently return 404 for the first fresh authorization navigation.
                window.setTimeout(() => {
                    try { if (!authorizationTab.closed) authorizationTab.location.href = target.href; } catch { /* Cross-origin navigation can disappear when the tab was closed. */ }
                }, 1_000);
            } else location.assign(target.href);
        } catch (reason) {
            authorizationTab?.close();
            error.textContent = (reason as Error).message; pending = false; connect.disabled = locked;
        }
    });
    async function remove() {
        const response = await fetch('/api/hf', { method: 'DELETE', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('HF-Verbindung konnte nicht getrennt werden.');
    }
    disconnect.addEventListener('click', async () => {
        if (locked || pending || !confirm('Persönliche HF-Verbindung auf diesem Gerät trennen?')) return;
        pending = true; connect.disabled = disconnect.disabled = true;
        try { await remove(); location.reload(); }
        catch (reason) { error.textContent = (reason as Error).message; pending = false; disconnect.disabled = locked; }
    });
    return {
        lock(value: boolean) { locked = value; open.disabled = value; if (value && dialog.open) dialog.close(); },
        signedIn() {
            const url = new URL(location.href), result = url.searchParams.get('hf');
            if (!result) return;
            url.searchParams.delete('hf'); history.replaceState(null, '', url);
            dialog.showModal();
            void load().then(() => { if (result !== 'connected') error.textContent = 'HF-Anmeldung wurde abgebrochen oder konnte nicht bestätigt werden. Bitte erneut verbinden.'; });
        },
        async signedOut() { dialog.close(); try { await remove(); } catch { /* Logout also clears both HF cookies. */ } }
    };
}
