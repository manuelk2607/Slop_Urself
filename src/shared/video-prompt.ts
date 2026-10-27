export const VIDEO_NEGATIVE_PROMPT = 'blurry, distorted, frozen subject, still image, flickering, extra limbs, deformed face, watermark';

export function validatePrompt(value: unknown) {
    if (typeof value !== 'string') throw new Error('Bitte gib einen Prompt ein.');
    const prompt = value.normalize('NFKC').trim();
    if (!prompt || prompt.length > 150 || /[\p{Cc}\p{Cf}]/u.test(prompt)) throw new Error('Bitte gib einen Prompt mit 1 bis 150 sichtbaren Zeichen ein.');
    return prompt;
}

// One source for UI preview, input moderation and the actual provider request.
// Explicit transformations/cuts take precedence over generic continuity hints.
export function buildVideoPrompt(value: string) {
    const prompt = validatePrompt(value);
    const punctuation = /[.!?。！？]$/u.test(prompt) ? '' : '.';
    return `${prompt}${punctuation} Animate the requested action clearly. Preserve details the request does not change. Use continuous natural movement unless the request specifies a different effect. Do not add unrelated actions or scene changes.`;
}
