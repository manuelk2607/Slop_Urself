import type { ContentReport } from '../security/reports';
const labels: Record<string, string> = { sexual_exploitation: 'Sexuelle Ausbeutung', nonconsensual: 'Intime Darstellung ohne Einwilligung', graphic_abuse: 'Grafische Gewalt oder Missbrauch', other: 'Anderer Regelverstoß' };
async function request(path: string, data?: object) {
    const response = await fetch(path, { ...(data ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15_000) });
    const result = await response.json() as { error?: string; reports?: (ContentReport & { blocked: boolean })[] };
    if (!response.ok) throw new Error(result.error || 'Die Inhaltsverwaltung ist gerade nicht erreichbar.');
    return result;
}
export function reportVideoButton(url: string) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-muted'; button.textContent = 'Inhalt melden';
    button.onclick = () => {
        const dialog = document.getElementById('contentReportDialog') as HTMLDialogElement;
        const form = document.getElementById('contentReportForm') as HTMLFormElement;
        const notice = document.getElementById('contentReportNotice')!;
        const submit = form.querySelector('button[type=submit]') as HTMLButtonElement;
        notice.textContent = ''; form.reset(); submit.disabled = false;
        document.getElementById('contentReportCancel')!.onclick = () => dialog.close();
        form.onsubmit = async event => {
            event.preventDefault(); submit.disabled = true;
            try {
                await request('/api/moderation/reports', { url, reason: (document.getElementById('contentReportReason') as HTMLSelectElement).value });
                notice.textContent = 'Danke. Die Meldung wurde zur Prüfung gespeichert.';
            } catch (error) { notice.textContent = error instanceof Error ? error.message : 'Meldung fehlgeschlagen.'; submit.disabled = false; }
        };
        dialog.showModal(); document.getElementById('contentReportReason')!.focus();
    };
    return button;
}
export async function loadContentReports(container: HTMLElement) {
    container.replaceChildren();
    const { reports = [] } = await request('/api/admin/moderation');
    const heading = document.createElement('h3'); heading.textContent = 'Inhaltsmeldungen'; container.append(heading);
    if (!reports.length) { const empty = document.createElement('p'); empty.textContent = 'Keine Inhaltsmeldungen.'; container.append(empty); }
    const seen = new Set<string>();
    for (const report of reports) {
        if (seen.has(report.url)) continue; seen.add(report.url);
        const row = document.createElement('p'), label = document.createElement('span');
        label.textContent = `${report.url.split('/').pop()} · ${labels[report.reason] || 'Regelverstoß'} · ${report.blocked ? 'Gesperrt' : 'Prüfung ausstehend'} `; row.append(label);
        if (!report.blocked) {
            const review = document.createElement('a'); review.href = report.url; review.target = '_blank'; review.rel = 'noopener noreferrer'; review.textContent = 'Video prüfen'; row.append(review);
            const block = document.createElement('button'); block.type = 'button'; block.className = 'stats-delete-button'; block.textContent = 'Video sperren';
            block.onclick = async () => {
                if (!confirm('Dieses Video für alle Spieler dauerhaft sperren? Löschen oder Rückgängig hebt diese Sperre nicht auf.')) return;
                block.disabled = true;
                try { await request('/api/admin/moderation/block', { url: report.url, confirmation: report.url }); await loadContentReports(container); }
                catch (error) { label.textContent = error instanceof Error ? error.message : 'Sperre fehlgeschlagen.'; block.disabled = false; }
            }; row.append(block);
        }
        container.append(row);
    }
}
