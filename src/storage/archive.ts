import { AwsClient } from 'aws4fetch';
import { XMLParser } from 'fast-xml-parser';

export interface ArchiveConfig {
    AWS_ACCESS_KEY_ID?: string; AWS_SECRET_ACCESS_KEY?: string; AWS_ENDPOINT_URL_S3?: string; AWS_REGION?: string;
    VIDEO_BUCKET?: string; VIDEO_ARCHIVE_MB?: string;
}
export interface ArchivedObject { key: string; size: number; modified: string }
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
export const archiveLimit = (config: ArchiveConfig) => Math.max(20, Math.min(1024, Number(config.VIDEO_ARCHIVE_MB) || 512)) * 1024 * 1024;
export const archiveEnabled = (config: ArchiveConfig) => Boolean(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY && config.AWS_ENDPOINT_URL_S3);
const validKey = (key: string) => /^videos\/\d{13}-[a-z0-9-]+\.mp4$/.test(key);
const client = (config: ArchiveConfig) => new AwsClient({ accessKeyId: config.AWS_ACCESS_KEY_ID!, secretAccessKey: config.AWS_SECRET_ACCESS_KEY!, service: 's3', region: config.AWS_REGION || 'eu-central-1' });
const endpoint = (config: ArchiveConfig, key = '') => `${config.AWS_ENDPOINT_URL_S3!.replace(/\/$/, '')}/${config.VIDEO_BUCKET || 'slopurself-videos'}/${key}`;

export async function listArchive(config: ArchiveConfig): Promise<ArchivedObject[]> {
    if (!archiveEnabled(config)) return [];
    const response = await client(config).fetch(`${endpoint(config)}?list-type=2&prefix=videos%2F`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Videoarchiv nicht erreichbar.');
    const result = new XMLParser({ isArray: name => name === 'Contents' }).parse(await response.text()).ListBucketResult;
    // The capped archive can contain at most a few hundred clips. Fail closed rather than undercount.
    if (String(result.IsTruncated) === 'true') throw new Error('Videoarchiv ist zu groß für eine sichere Speicherprüfung.');
    return (result.Contents || []).map((item: { Key: string; Size: number; LastModified: string }) => ({ key: item.Key, size: Number(item.Size), modified: item.LastModified }));
}
export function evictionPlan(objects: ArchivedObject[], incoming: number, limit: number, protectedKeys: ReadonlySet<string> = new Set()) {
    if (incoming > limit) throw new Error('Video ist größer als das Archivlimit.');
    let total = objects.reduce((sum, object) => sum + object.size, incoming);
    const remove: ArchivedObject[] = [];
    for (const object of [...objects].sort((a, b) => a.modified.localeCompare(b.modified) || a.key.localeCompare(b.key))) {
        if (total <= limit) break;
        if (protectedKeys.has(object.key)) continue;
        remove.push(object); total -= object.size;
    }
    if (total > limit) throw new Error('Im Archiv sind noch Videos für Rückgängig reserviert. Bitte versuche es gleich erneut.');
    return remove;
}
export async function downloadVideo(url: string) {
    let target = new URL(url);
    const signal = AbortSignal.timeout(45_000);
    for (let hop = 0; hop < 4; hop++) {
        if (target.protocol !== 'https:' || !(/^[a-z0-9-]+\.hf\.space$/.test(target.hostname) || target.hostname === 'huggingface.co' || target.hostname.endsWith('.hf.co'))) throw new Error('Ungültige Videoquelle.');
        const response = await fetch(target, { redirect: 'manual', signal });
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { target = new URL(response.headers.get('location')!, target); continue; }
        if (response.status === 403 || response.status === 404) throw new Error('Die KI-Videodatei ist nicht mehr erreichbar. Es wurde kein abspielbares Video gespeichert.');
        if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_VIDEO_BYTES) throw new Error('Video nicht erreichbar oder größer als 15 MB.');
        const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
        try {
            while (true) {
                const part = await reader.read(); if (part.done) break;
                length += part.value.length;
                if (length > MAX_VIDEO_BYTES) throw new Error('Video ist größer als 15 MB.');
                parts.push(part.value);
            }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        if (length < 12 || new TextDecoder().decode(bytes.slice(4, 8)) !== 'ftyp') throw new Error('KI-Ergebnis ist keine MP4-Datei.');
        return bytes;
    }
    throw new Error('Zu viele Weiterleitungen der Videoquelle.');
}

// Called under the global service queue, including deletion before the new upload.
export async function archiveVideo(url: string, config: ArchiveConfig, protectedUrls: string[] = []) {
    if (url.startsWith('/assets/')) return url;
    if (!archiveEnabled(config)) throw new Error('Die Zugangsdaten für das dauerhafte Videoarchiv fehlen.');
    const bytes = await downloadVideo(url);
    const objects = await listArchive(config);
    const protectedKeys = new Set(protectedUrls.filter(url => url.startsWith('/api/videos/')).map(url => url.slice('/api/videos/'.length)));
    for (const old of evictionPlan(objects, bytes.length, archiveLimit(config), protectedKeys)) {
        const response = await client(config).fetch(endpoint(config, old.key), { method: 'DELETE', signal: AbortSignal.timeout(15_000) });
        if (!response.ok && response.status !== 404) throw new Error('Altes Video konnte nicht gelöscht werden; Archivierung pausiert.');
    }
    const key = `videos/${Date.now()}-${crypto.randomUUID()}.mp4`;
    const response = await client(config).fetch(endpoint(config, key), { method: 'PUT', body: bytes, headers: { 'content-type': 'video/mp4', 'cache-control': 'private, max-age=300' }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Video konnte nicht dauerhaft gespeichert werden.');
    return `/api/videos/${key}`;
}
export async function serveVideo(request: Request, key: string, config: ArchiveConfig) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    if (!validKey(key)) return new Response(null, { status: 404 });
    if (!archiveEnabled(config)) return new Response(null, { status: 503 });
    const range = request.headers.get('range');
    let response: Response;
    try {
        response = await client(config).fetch(endpoint(config, key), { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: range ? { range } : {}, signal: AbortSignal.timeout(30_000) });
    } catch { return new Response(null, { status: 503 }); }
    if (response.status === 404) return new Response(null, { status: 410 });
    if (response.status === 416) return new Response(null, { status: 416,
        headers: response.headers.has('content-range') ? { 'content-range': response.headers.get('content-range')! } : {} });
    if (!response.ok) return new Response(null, { status: 503 });
    const headers = new Headers({ 'content-type': 'video/mp4', 'cache-control': 'private, max-age=300', 'accept-ranges': 'bytes' });
    for (const name of ['content-length', 'content-range', 'etag']) if (response.headers.has(name)) headers.set(name, response.headers.get(name)!);
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

export async function deleteArchivedVideo(url: string, config: ArchiveConfig) {
    if (!url.startsWith('/api/videos/')) return;
    const key = url.slice('/api/videos/'.length);
    if (!validKey(key)) throw new Error('Ungültiger Archivschlüssel.');
    if (!archiveEnabled(config)) throw new Error('Der Videospeicher ist nicht eingerichtet.');
    const response = await client(config).fetch(endpoint(config, key), { method: 'DELETE', signal: AbortSignal.timeout(15_000) });
    if (!response.ok && response.status !== 404) throw new Error('Die Videodatei konnte nicht gelöscht werden. Bitte versuche es erneut.');
}
