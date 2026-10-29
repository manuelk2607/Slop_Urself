import { preparedImageSize } from '../ai/images';
import { validateImage } from '../ai/image-input';
import { normalizeImage } from '../security/images';
import { moderateInput, type ModerationConfig } from '../security/moderation';

export interface SharedImage { id: string; chunks: number; expiresAt: number }
export interface ImageStorage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void>; delete(key: string): Promise<unknown> }
const CHUNK_SIZE = 64 * 1024;
export const IMAGE_TTL = 2 * 60 * 60_000;
const key = (image: SharedImage, part: number) => `image:${image.id}:${part}`;
export async function writeSharedImage(storage: ImageStorage, data: unknown, config?: ModerationConfig, beforeWrite?: (image: SharedImage) => Promise<void>): Promise<SharedImage> {
    const text = await normalizeImage(data);
    const image = validateImage(text); preparedImageSize(image.base64);
    if (config) await moderateInput(text, '', config);
    const meta = { id: crypto.randomUUID(), chunks: Math.ceil(text.length / CHUNK_SIZE), expiresAt: Date.now() + IMAGE_TTL };
    await beforeWrite?.(meta);
    try { for (let part = 0; part < meta.chunks; part++) await storage.put(key(meta, part), text.slice(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE)); }
    catch (error) { await deleteSharedImage(storage, meta); throw error; }
    return meta;
}
export async function readSharedImage(storage: ImageStorage, image?: SharedImage) {
    if (!image || image.expiresAt <= Date.now()) throw new Error('Das gemeinsame Bild fehlt oder ist abgelaufen. Der Host muss ein neues Bild auswählen.');
    let text = '';
    for (let part = 0; part < image.chunks; part++) {
        const chunk = await storage.get<string>(key(image, part));
        if (typeof chunk !== 'string') throw new Error('Das gemeinsame Bild ist gerade nicht verfügbar.');
        text += chunk;
    }
    return text;
}
export async function deleteSharedImage(storage: ImageStorage, image?: SharedImage) {
    if (image) for (let part = 0; part < image.chunks; part++) await storage.delete(key(image, part));
}
export async function sharedImageResponse(request: Request, storage: ImageStorage, image?: SharedImage) {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    if (!image || new URL(request.url).searchParams.get('id') !== image.id) return new Response(null, { status: 404 });
    try {
        const data = validateImage(await readSharedImage(storage, image));
        const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0));
        return new Response(bytes, { headers: { 'content-type': data.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    } catch { return new Response(null, { status: 410 }); }
}
