export type HistoryKind = 'videos' | 'rooms';

interface HistorySelection {
    kind: HistoryKind;
    list: HTMLElement;
    confirmation(count: number): string;
    remove(urls: string[]): Promise<string[]>;
}

export function historySelection({ kind, list, confirmation, remove }: HistorySelection) {
    const plural = kind === 'videos' ? 'Videos' : 'Rooms';
    const singular = kind === 'videos' ? 'video' : 'room';
    const edit = document.getElementById(`edit${plural}Button`) as HTMLButtonElement;
    const toolbar = document.getElementById(`${singular}EditToolbar`)!;
    const selectAll = document.getElementById(`selectAll${plural}`) as HTMLInputElement;
    const deleteSelected = document.getElementById(`deleteSelected${plural}`) as HTMLButtonElement;
    const count = document.getElementById(`${singular}SelectionCount`)!;
    const selected = new Set<string>();
    let editing = false;
    let deleting = false;

    function update() {
        const inputs = [...list.querySelectorAll<HTMLInputElement>('.history-selection input')];
        for (const input of inputs) {
            input.checked = selected.has(input.value);
            input.disabled = deleting;
            input.closest<HTMLElement>('.history-selection')!.hidden = !editing;
        }
        const checked = inputs.filter(input => input.checked).length;
        selectAll.checked = inputs.length > 0 && checked === inputs.length;
        selectAll.indeterminate = checked > 0 && checked < inputs.length;
        selectAll.disabled = deleting || inputs.length === 0;
        deleteSelected.disabled = deleting || selected.size === 0;
        edit.disabled = deleting;
        edit.setAttribute('aria-pressed', String(editing));
        edit.textContent = editing ? 'Fertig' : 'Bearbeiten';
        toolbar.hidden = !editing;
        count.textContent = `${selected.size} ausgewählt`;
    }

    function forget(matches: (url: string) => boolean) {
        for (const url of selected) if (matches(url)) selected.delete(url);
        update();
    }

    function reset() { editing = false; selected.clear(); update(); }

    function checkbox(url: string, description: string) {
        const label = document.createElement('label');
        label.className = `history-selection ${singular}-selection history-select-label`;
        label.hidden = !editing;
        const input = document.createElement('input');
        input.type = 'checkbox'; input.value = url;
        input.setAttribute('aria-label', description);
        input.addEventListener('change', () => {
            if (input.checked) selected.add(url); else selected.delete(url);
            update();
        });
        label.append(input, document.createTextNode('Auswählen'));
        return label;
    }

    edit.addEventListener('click', () => {
        editing = !editing;
        if (!editing) selected.clear();
        update();
    });
    selectAll.addEventListener('change', () => {
        list.querySelectorAll<HTMLInputElement>('.history-selection input').forEach(input => {
            if (selectAll.checked) selected.add(input.value); else selected.delete(input.value);
        });
        update();
    });
    deleteSelected.addEventListener('click', async () => {
        const urls = [...selected];
        if (deleting || !urls.length || !window.confirm(confirmation(urls.length))) return;
        deleting = true; update();
        try {
            const failed = await remove(urls);
            forget(url => urls.includes(url) && !failed.includes(url));
        } finally { deleting = false; update(); }
    });
    return { update, reset, checkbox, forget };
}
