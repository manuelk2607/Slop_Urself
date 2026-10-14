interface ManagedAccount { id: string; name: string; protected: boolean }
interface AccountAccess { available: boolean; unlocked: boolean; accounts: ManagedAccount[] }

export function accountManagement() {
    const section = document.getElementById('accountManagement')!;
    const form = document.getElementById('adminUnlockForm') as HTMLFormElement;
    const key = document.getElementById('adminKey') as HTMLInputElement;
    const list = document.getElementById('accountManagementList')!;
    const notice = document.getElementById('accountManagementNotice')!;
    const lock = document.getElementById('lockAccountsButton') as HTMLButtonElement;
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
        ++revision; section.hidden = true; key.value = ''; list.replaceChildren(); notice.hidden = true;
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
            if (!access.unlocked) return;
            for (const account of access.accounts) {
                const li = document.createElement('li'); li.className = 'score-item account-management-item';
                const name = document.createElement('strong'); name.textContent = account.name;
                li.append(name);
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
