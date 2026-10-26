export type GenerationStage = 'preparing' | 'queue' | 'inference' | 'result' | 'archive' | 'retry';
export type AiProgress = (message: string, stage?: GenerationStage) => void;
export interface GenerationView { id: string; startedAt: number; stage: GenerationStage }
const labels: Record<GenerationStage, string> = {
    preparing: 'Bild und Auftrag werden vorbereitet.', queue: 'Warte auf einen kostenlosen GPU-Platz.',
    inference: 'Die KI berechnet das Video.', result: 'Der vorhandene Auftrag wird abgefragt.',
    archive: 'Video wird geprüft und gespeichert.', retry: 'Der Auftragsstatus ist noch unklar und wird erneut abgefragt.'
};
export function generationMessage(view: GenerationView) {
    return `${labels[view.stage] || 'Der Auftragsstatus wird geprüft.'}${view.stage === 'retry' || view.stage === 'archive' ? ' Der bestehende Auftrag wird weiterverwendet.' : ''}`;
}
export function generationElapsed(view: GenerationView, serverTime: number) {
    const seconds = Math.max(0, Math.floor((serverTime - view.startedAt) / 1000));
    return `Vergangen: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} Min.`;
}
