export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function validateImage(value: unknown): { mime: string; base64: string } {
    if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 100) {
        throw new Error('Bitte nutze ein Bild bis maximal 8 MB.');
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) {
        throw new Error('Bitte lade ein gültiges PNG-, JPEG- oder WebP-Bild hoch.');
    }
    const bytes = atob(match[2]);
    const valid = match[1] === 'image/png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
        : match[1] === 'image/jpeg' ? bytes.startsWith('\xff\xd8\xff')
        : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
    if (!valid || bytes.length > MAX_IMAGE_BYTES) throw new Error('Die Bilddatei ist ungültig oder zu groß.');
    return { mime: match[1], base64: match[2] };
}
