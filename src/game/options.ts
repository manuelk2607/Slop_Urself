import { generationQuality, type GenerationQuality } from '../ai/providers';

export type GameMode = 'classic' | 'archive-vote' | 'archive-guess';
export interface GameOptions { sharedImage: boolean; secretTasks: boolean; guessPrompt: boolean; quality: GenerationQuality; mode: GameMode; phaseSeconds: number }
export function gameOptions(value?: unknown): GameOptions {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    for (const key of ['sharedImage', 'secretTasks', 'guessPrompt']) if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error('Ungültige Spielvariante.');
    const mode = data.mode ?? 'classic', phaseSeconds = data.phaseSeconds ?? 0;
    if (!['classic', 'archive-vote', 'archive-guess'].includes(mode as string)) throw new Error('Ungültiger Spielmodus.');
    if (![0, 60, 120, 180, 300].includes(phaseSeconds as number)) throw new Error('Ungültiges Zeitlimit.');
    return { sharedImage: mode === 'classic' && data.sharedImage === true, secretTasks: mode === 'classic' && data.secretTasks === true,
        guessPrompt: mode === 'archive-guess' || (mode === 'classic' && data.guessPrompt === true), quality: generationQuality(data.quality), mode: mode as GameMode, phaseSeconds: phaseSeconds as number };
}

export const SECRET_TASKS = [
    'Lass etwas unerwartet schweben.', 'Erzeuge eine kleine Tanzbewegung.',
    'Lass eine Bewegung rückwärts ablaufen.', 'Verwandle die Szene in einen dramatischen Filmmoment.',
    'Lass etwas plötzlich viel schneller werden.', 'Erzeuge eine möglichst unauffällige Bewegung.',
    'Lass etwas im Bild auf die Kamera zukommen.', 'Lass etwas eine überraschende Drehung machen.',
    'Erzeuge einen komischen Überraschungsmoment.', 'Lass etwas im Bild sichtbar erschrecken.',
    'Lass etwas elegant durch die Szene gleiten.', 'Erzeuge eine Bewegung wie in einem Musikvideo.',
    'Lass etwas aus dem Bild verschwinden.', 'Erzeuge eine möglichst übertriebene Bewegung.',
    'Lass eine ruhige Szene plötzlich lebendig werden.', 'Erzeuge eine kleine Verfolgungsjagd.'
];

export function assignTasks(ids: string[]) {
    const tasks = [...SECRET_TASKS];
    for (let i = tasks.length - 1; i > 0; i--) {
        const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (i + 1));
        [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    }
    return Object.fromEntries(ids.map((id, index) => [id, tasks[index % tasks.length]]));
}
