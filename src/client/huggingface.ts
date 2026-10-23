import { createElement, Link2, X, Copy } from 'lucide';

interface Connection { configured?: boolean; connected?: boolean; username?: string; remainingSeconds?: number; totalSeconds?: number; error?: string }
interface Device { pending?: boolean; userCode?: string; verificationUrl?: string; expiresAt?: number; retryAfter?: number; connected?: boolean; error?: string }
export function huggingFaceConnection() {
    const open = document.getElementById('hfAccountButton') as HTMLButtonElement;
    const dialog = document.getElementById('hfDialog') as HTMLDialogElement;
    const close = document.getElementById('hfCloseButton') as HTMLButtonElement;
    const connect = document.getElementById('hfConnectButton') as HTMLButtonElement;
    const disconnect = document.getElementById('hfDisconnectButton') as HTMLButtonElement;
    const status = document.getElementById('hfStatus')!;
    const error = document.getElementById('hfError')!;
    const device = document.getElementById('hfDevice')!;
    const code = document.getElementById('hfDeviceCode')!;
    const deviceLink = document.getElementById('hfDeviceLink') as HTMLAnchorElement;
    const copy = document.getElementById('hfCopyCode') as HTMLButtonElement;
    const cancel = document.getElementById('hfDeviceCancel') as HTMLButtonElement;
    const requirement = document.getElementById('hfRequirement')!;
    open.prepend(createElement(Link2, { width: 16, height: 16, 'aria-hidden': 'true' }));
    close.replaceChildren(createElement(X, { width: 20, height: 20, 'aria-hidden': 'true' }));
    copy.replaceChildren(createElement(Copy, { width: 20, height: 20, 'aria-hidden': 'true' }));
    let locked = false, pending = false, recovering = false;
    let required = false;
    let clock: number | undefined, epoch = 0, expiresAt = 0;
    function stop() { epoch++; window.clearTimeout(clock); }
    async function requestDevice(method: string, path = '/api/hf/device') {
        const response = await fetch(path, { method, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
        const data = await response.json() as Device;
        if (!response.ok) throw new Error(data.error || 'HF-Verbindung ist gerade nicht erreichbar.');
        return data;
    }
    function schedule(seconds: number, version: number) {
        window.clearTimeout(clock);
        clock = window.setTimeout(() => { void poll(version); }, Math.max(5, seconds) * 1000);
    }
    async function poll(version: number) {
        if (version !== epoch || !dialog.open || locked) return;
        if (Date.now() >= expiresAt) { error.textContent = 'Der HF-Code ist abgelaufen. Bitte erneut verbinden.'; resetDevice(); return; }
        try {
            const data = await requestDevice('POST', '/api/hf/device-poll');
            if (version !== epoch) return;
            if (data.connected) {
                stop(); const target = new URL(location.href); target.searchParams.set('hf', 'connected'); location.replace(target.href); return;
            }
            if (data.error) { error.textContent = data.error; resetDevice(); return; }
            error.textContent = ''; schedule(data.retryAfter || 5, version);
        } catch (reason) {
            if (version !== epoch) return;
            error.textContent = (reason as Error).message; schedule(15, version);
        }
    }
    function resetDevice() { stop(); pending = false; device.hidden = true; connect.hidden = false; connect.disabled = locked; }
    function showDevice(data: Device) {
        const target = new URL(data.verificationUrl || '');
        if (!['https://huggingface.co', 'https://hf.co'].includes(target.origin) || target.pathname !== '/oauth/device'
            || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.userCode || '') || !Number.isFinite(data.expiresAt)) throw new Error('Ungültige HF-Anmeldeadresse.');
        stop(); pending = true; expiresAt = data.expiresAt!;
        code.textContent = data.userCode!; deviceLink.href = target.href;
        device.hidden = false; connect.hidden = true; disconnect.disabled = true;
        status.textContent = 'Bestätigung bei Hugging Face ausstehend';
        schedule(data.retryAfter || 5, epoch);
    }
    async function load() {
        resetDevice();
        connect.disabled = disconnect.disabled = true; error.textContent = '';
        status.textContent = 'HF-Verbindung wird geprüft …';
        try {
            const response = await fetch('/api/hf', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new Error('HF-Verbindung ist gerade nicht erreichbar.');
            const data = await response.json() as Connection;
            status.textContent = data.connected ? `${data.username} · ${data.remainingSeconds} / ${data.totalSeconds} GPU-Sekunden`
                : data.configured ? 'Verbinde dein persönliches HF-Konto, um mitzuspielen.' : 'Die HF-Anmeldung ist auf diesem Server noch nicht eingerichtet.';
            requirement.hidden = !required || Boolean(data.connected);
            open.lastChild!.textContent = data.connected ? ' KI-Konto' : ' HF verbinden';
            connect.textContent = data.connected ? 'HF-Verbindung erneuern' : 'Hugging Face verbinden';
            disconnect.hidden = !data.connected; disconnect.disabled = locked;
            if (data.error) error.textContent = data.error;
            const active = await requestDevice('GET');
            if (active.pending && dialog.open && !locked) showDevice(active);
            else connect.disabled = locked || !data.configured;
        } catch (reason) { error.textContent = (reason as Error).message; }
    }
    open.addEventListener('click', () => { dialog.showModal(); void load(); });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', stop);
    copy.addEventListener('click', () => { void navigator.clipboard.writeText(code.textContent || '').then(() => { copy.title = 'Code kopiert'; }).catch(() => { error.textContent = 'Bitte den angezeigten Code markieren und kopieren.'; }); });
    cancel.addEventListener('click', async () => {
        stop(); cancel.disabled = true;
        try { await requestDevice('DELETE'); resetDevice(); await load(); }
        catch (reason) { error.textContent = (reason as Error).message; }
        finally { cancel.disabled = false; }
    });
    connect.addEventListener('click', async () => {
        if (locked || pending) return;
        pending = true; connect.disabled = disconnect.disabled = true; error.textContent = '';
        try {
            const data = await requestDevice('POST');
            if (dialog.open && !locked) showDevice(data);
        } catch (reason) {
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
        lock(value: boolean) { locked = value && !recovering; open.disabled = locked; if (locked && dialog.open) dialog.close(); },
        async ensurePlayer() {
            if (!required) return true;
            try {
                const response = await fetch('/api/hf', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
                if (response.ok && (await response.json() as Connection).connected) return true;
            } catch { /* The connection dialog offers recovery. */ }
            recovering = true; locked = false; open.disabled = false;
            if (!dialog.open) dialog.showModal();
            await load();
            return false;
        },
        require() {
            recovering = true; locked = false; open.disabled = false;
            if (!dialog.open) dialog.showModal();
            void load();
        },
        async signedIn(hfRequired: boolean) {
            recovering = false;
            required = hfRequired;
            requirement.hidden = !required;
            const url = new URL(location.href), result = url.searchParams.get('hf');
            if (!result) { if (required) await load(); return; }
            url.searchParams.delete('hf'); history.replaceState(null, '', url);
            dialog.showModal();
            void load().then(() => { if (result !== 'connected') error.textContent = 'HF-Anmeldung wurde abgebrochen oder konnte nicht bestätigt werden. Bitte erneut verbinden.'; });
        },
        async signedOut() { required = true; recovering = false; requirement.hidden = true; dialog.close(); try { await remove(); } catch { /* Logout also clears both HF cookies. */ } }
    };
}
