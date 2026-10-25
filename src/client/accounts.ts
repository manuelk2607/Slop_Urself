import { createElement, KeyRound } from 'lucide';
import { loadContentReports } from './content-reports';
interface ManagedAccount { id: string; name: string; protected: boolean; passwordProtected?: boolean }
interface AccountAccess { available: boolean; unlocked: boolean; accounts: ManagedAccount[] }

export function accountManagement() {
    const section = document.getElementById('accountManagement')!;
    const form = document.getElementById('adminUnlockForm') as HTMLFormElement;
    const key = document.getElementById('adminKey') as HTMLInputElement;
    const list = document.getElementById('accountManagementList')!;
    const contentReports = document.getElementById('contentReports')!;
    const notice = document.getElementById('accountManagementNotice')!;
    const lock = document.getElementById('lockAccountsButton') as HTMLButtonElement;
    const dialog = document.getElementById('profilePasswordDialog') as HTMLDialogElement;
    const passwordForm = document.getElementById('profilePasswordForm') as HTMLFormElement;
    const password = document.getElementById('profilePasswordValue') as HTMLInputElement;
    const confirmation = document.getElementById('profilePasswordConfirmation') as HTMLInputElement;
    const passwordError = document.getElementById('profilePasswordError')!;
    let target: ManagedAccount | undefined;
    function clearPassword() { password.value = ''; confirmation.value = ''; passwordError.textContent = ''; target = undefined; }
    const closePassword = () => { clearPassword(); dialog.close(); };
    dialog.addEventListener('close', clearPassword);
    dialog.addEventListener('cancel', clearPassword);
    document.getElementById('profilePasswordCancel')!.addEventListener('click', closePassword);
    passwordForm.addEventListener('submit', async event => {
        event.preventDefault(); if (!target) return;
        const button = passwordForm.querySelector('button')!, id = target.id;
        button.disabled = true; passwordError.textContent = '';
        try { await request(`/api/admin/accounts/${encodeURIComponent(id)}/password`, 'POST', { confirmation: confirmation.value, password: password.value }); closePassword(); await load(); }
        catch (error) { passwordError.textContent = (error as Error).message; }
        finally { button.disabled = false; }
    });
    let revision = 0;
    const showError = (error: unknown) => { notice.textContent = error instanceof Error ? error.message : 'Benutzerverwaltung nicht erreichbar.'; notice.hidden = false; };
    async function request(url: string, method = 'GET', body?: unknown) {
        const response = await fetch(url, { method, cache: 'no-store', signal: AbortSignal.timeout(15_000),
            ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
        const data = await response.json() as AccountAccess & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Benutzerverwaltung nicht erreichbar.');
        return data;
    }
    function reset() {
        if (dialog.open) closePassword();
        ++revision; section.hidden = true; key.value = ''; list.replaceChildren(); contentReports.replaceChildren(); notice.hidden = true;
    }
    async function load() {
        const current = ++revision;
        try {
            const access = await request('/api/admin/accounts');
            if (current !== revision) return;
            section.hidden = !access.available;
            form.hidden = !access.available || access.unlocked;
            lock.hidden = !access.available || !access.unlocked;
            list.replaceChildren();
            contentReports.replaceChildren();
            if (!access.unlocked) return;
            for (const account of access.accounts) {
                const li = document.createElement('li'); li.className = 'score-item account-management-item';
                const name = document.createElement('strong'); name.textContent = account.name;
                li.append(name);
                const protect = document.createElement('button'); protect.type = 'button'; protect.className = 'icon-button';
                protect.title = protect.ariaLabel = account.passwordProtected ? 'Passwort erneuern' : 'Passwort setzen';
                protect.append(createElement(KeyRound, { width: 18, height: 18, 'aria-hidden': 'true' }));
                protect.addEventListener('click', () => {
                    target = account; document.getElementById('profilePasswordTarget')!.textContent = `Benutzer: ${account.name}. Alle bisherigen Sitzungen werden ungültig.`;
                    dialog.showModal(); confirmation.focus();
                }); li.append(protect);
                if (account.protected) {
                    const label = document.createElement('small'); label.textContent = 'Besitzer'; li.append(label);
                } else {
                    const button = document.createElement('button'); button.type = 'button'; button.className = 'stats-delete-button'; button.textContent = 'Benutzer löschen';
                    button.addEventListener('click', async () => {
                        if (!window.confirm(`Benutzer „${account.name}“ wirklich dauerhaft löschen? Seine bisherigen Spiele, Videos und Punkte bleiben erhalten. Seine alten Sitzungen werden ungültig.`)) return;
                        button.disabled = true; notice.hidden = true;
                        try { await request(`/api/admin/accounts/${encodeURIComponent(account.id)}`, 'DELETE', { confirmation: account.name }); await load(); }
                        catch (error) { showError(error); }
                        finally { button.disabled = false; }
                    });
                    li.append(button);
                }
                list.append(li);
            }
            await loadContentReports(contentReports);
        } catch (error) { if (current === revision && !section.hidden) showError(error); }
    }
    form.addEventListener('submit', async event => {
        event.preventDefault(); const button = form.querySelector('button')!; button.disabled = true; notice.hidden = true;
        const value = key.value; key.value = '';
        try { await request('/api/admin/session', 'POST', { key: value }); await load(); }
        catch (error) { showError(error); }
        finally { button.disabled = false; }
    });
    lock.addEventListener('click', async () => {
        lock.disabled = true; notice.hidden = true;
        try { await request('/api/admin/session', 'DELETE'); await load(); }
        catch (error) { showError(error); }
        finally { lock.disabled = false; }
    });
    return { load, reset };
}
