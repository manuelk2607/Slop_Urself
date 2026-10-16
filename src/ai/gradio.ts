export class GradioProviderError extends Error {
    constructor(message: string, public code = 'provider_error') { super(message); }
}

function providerFailure(value: unknown) {
    const message = (typeof value === 'string' ? value : JSON.stringify(value) || '').slice(0, 4096);
    if (/out of memory|OutOfMemoryError|CUDA.*memory/i.test(message)) return new GradioProviderError('Der GPU-Speicher des KI-Anbieters reicht für diesen Auftrag nicht aus.', 'provider_memory');
    if (/queue.*full|too many.*requests|rate.?limit/i.test(message)) return new GradioProviderError('Die Warteschlange des KI-Anbieters ist voll. Bitte später erneut versuchen.', 'provider_queue');
    if (/worker.*restart|server.*stopp|shutdown|connection.*closed/i.test(message)) return new GradioProviderError('Der KI-Server wurde während der Erstellung unterbrochen.', 'provider_restart');
    if (/quota|daily limit|usage limit/i.test(message)) return new GradioProviderError('Der KI-Anbieter meldet ein erreichtes kostenloses GPU-Limit. Bitte nach dem Zur\u00fccksetzen erneut versuchen.', 'provider_quota');
    if (/unauthenticated|unauthorized|sign in|log ?in|authentication/i.test(message)) return new GradioProviderError('Der KI-Anbieter konnte die Hugging-Face-Anmeldung nicht zuordnen. Bitte den HF_TOKEN pr\u00fcfen.', 'provider_auth');
    if (/file not allowed|file.*not found|filenotfound|validation|preprocess/i.test(message)) return new GradioProviderError('Der KI-Anbieter konnte das hochgeladene Bild nicht verarbeiten. Bitte das Bild erneut ausw\u00e4hlen.', 'provider_input');
    if (/zerogpu|allocation|no gpu|gpu.*available|timed? ?out|duration/i.test(message)) return new GradioProviderError('Der kostenlose GPU-Dienst ist ausgelastet oder hat die Berechnung zeitlich abgebrochen. Bitte sp\u00e4ter erneut versuchen.', 'provider_gpu');
    return new GradioProviderError('Der KI-Anbieter hat die Generierung ohne nähere Fehlerangabe abgebrochen.', message.trim() ? 'provider_unclassified' : 'provider_no_details');
}

export async function readQueueResult(response: Response, eventId: string, progress: (step: string) => void = () => {}): Promise<{ data: unknown[] }> {
    if (!response.body) throw new Error('Hugging Face hat keinen Ergebnisstream geliefert.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', lastStage = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                if (boundary > 1024 * 1024) throw new Error('Ung\u00fcltiger KI-Ergebnisstream.');
                const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
                if (!raw) continue;
                const message = JSON.parse(raw);
                if (!message || (message.event_id && message.event_id !== eventId)) continue;
                if (message.msg === 'server_stopped') throw new GradioProviderError('Der KI-Server wurde während der Erstellung unterbrochen.', 'provider_restart');
                if (message.msg === 'unexpected_error') throw providerFailure(message.message);
                if (message.msg === 'process_completed' && message.event_id === eventId) {
                    if (message.success !== true) throw providerFailure(message.output?.error);
                    if (!Array.isArray(message.output?.data)) throw new Error('Hugging Face lieferte kein Video-Ergebnis.');
                    return { data: message.output.data };
                }
                if (message.msg !== lastStage) {
                    if (message.msg === 'estimation') progress('Warte auf einen kostenlosen GPU-Platz...');
                    if (message.msg === 'process_starts') progress('Die KI berechnet das Video...');
                    lastStage = message.msg;
                }
            }
            if (buffer.length > 1024 * 1024) throw new Error('Ung\u00fcltiger KI-Ergebnisstream.');
            if (done) throw new Error('Hugging Face hat die Generierung nicht abgeschlossen.');
        }
    } finally { await reader.cancel().catch(() => {}); }
}
