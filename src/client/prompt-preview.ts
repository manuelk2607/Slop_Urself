import { buildVideoPrompt, VIDEO_NEGATIVE_PROMPT } from '../shared/video-prompt';

export function promptPreview(input: HTMLInputElement) {
    const details = document.createElement('details'); details.id = 'promptPreview'; details.className = 'hint-text'; details.hidden = true;
    const summary = document.createElement('summary'); summary.textContent = 'Vollständige KI-Anweisung ansehen';
    const text = document.createElement('p'); text.id = 'effectivePrompt'; text.lang = 'en'; text.style.overflowWrap = 'anywhere';
    const explanation = document.createElement('p'); explanation.textContent = 'Dein Text wird um kurze Bewegungshinweise ergänzt. Ausdrücklich gewünschte Veränderungen bleiben maßgeblich. Gespeichert wird deine Anweisung ohne diese Ergänzungen.';
    const negative = document.createElement('p'); negative.lang = 'en'; negative.textContent = `Negative prompt: ${VIDEO_NEGATIVE_PROMPT}`;
    details.append(summary, explanation, text, negative); input.after(details);
    const update = () => {
        try { text.textContent = buildVideoPrompt(input.value); details.hidden = false; }
        catch { text.textContent = ''; details.hidden = true; details.open = false; }
    };
    input.addEventListener('input', update); update(); return update;
}
