import { decode as decodeJpeg } from 'jpeg-js';
import { validateImage } from '../ai/image-input';

const MAX_PIXELS = 832 * 832;
const bad = () => new Error('Das Bild ist beschädigt oder nicht unterstützt. Bitte wähle es erneut aus.');
const u32 = (b: Uint8Array, offset: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset);
const set32 = (b: Uint8Array, offset: number, value: number) => new DataView(b.buffer).setUint32(offset, value);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
    return value >>> 0;
});
function crc(bytes: Uint8Array) {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8;
    return (value ^ 0xffffffff) >>> 0;
}
function dimensions(width: number, height: number) {
    if (!width || !height || width > 1024 || height > 1024 || width * height > MAX_PIXELS) throw new Error('Das Bild hat zu viele Pixel. Bitte nutze die Bildauswahl im Spiel.');
}
async function collect(stream: ReadableStream<Uint8Array>, limit: number) {
    const reader = stream.getReader(), parts: Uint8Array[] = []; let length = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.byteLength; if (length > limit) throw bad(); parts.push(value);
        }
    } finally { await reader.cancel().catch(() => {}); }
    const data = new Uint8Array(length); let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.length; }
    return data;
}
const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
function chunk(type: string, data: Uint8Array) {
    const out = new Uint8Array(data.length + 12); set32(out, 0, data.length);
    out.set(new TextEncoder().encode(type), 4); out.set(data, 8); set32(out, out.length - 4, crc(out.subarray(4, out.length - 4))); return out;
}
async function encodePng(pixels: Uint8Array, width: number, height: number) {
    const rows = new Uint8Array(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    const compressed = await collect(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate')), 8 * 1024 * 1024);
    const header = new Uint8Array(13); set32(header, 0, width); set32(header, 4, height); header[8] = 8; header[9] = 6;
    const pieces = [pngSignature, chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())];
    const result = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0)); let offset = 0;
    for (const part of pieces) { result.set(part, offset); offset += part.length; }
    let text = ''; for (let start = 0; start < result.length; start += 16384) text += String.fromCharCode(...result.subarray(start, start + 16384));
    return `data:image/png;base64,${btoa(text)}`;
}
function paeth(a: number, b: number, c: number) {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
}
async function decodePng(bytes: Uint8Array) {
    let offset = 8, width = 0, height = 0, channels = 0, ended = false, seenData = false, dataEnded = false;
    const compressed: Uint8Array[] = [];
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) throw bad();
        const length = u32(bytes, offset), end = offset + 12 + length;
        if (end > bytes.length) throw bad();
        const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)), data = bytes.subarray(offset + 8, end - 4);
        if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) throw bad();
        if (crc(bytes.subarray(offset + 4, end - 4)) !== u32(bytes, end - 4)) throw bad();
        if (offset === 8 && type !== 'IHDR') throw bad();
        if (type === 'IHDR') {
            if (offset !== 8 || length !== 13) throw bad();
            width = u32(data, 0); height = u32(data, 4); dimensions(width, height);
            channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[data[9]];
            if (data[8] !== 8 || !channels || data[10] || data[11] || data[12]) throw bad();
        } else if (type === 'IDAT') {
            if (!channels || dataEnded) throw bad(); compressed.push(data); seenData = true;
        } else if (type === 'IEND') {
            if (length || !seenData || end !== bytes.length) throw bad(); ended = true; break;
        } else {
            if (seenData) dataEnded = true;
            // Ignore metadata only. Palette/transparency/animation semantics are
            // intentionally rejected; normal browser uploads are JPEG-normalized.
            if (type === 'tRNS' || type === 'acTL' || type === 'PLTE' || type[0] === type[0].toUpperCase()) throw bad();
        }
        offset = end;
    }
    if (!ended) throw bad();
    const expected = height * (width * channels + 1);
    const raw = await collect(new Blob(compressed as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate')), expected);
    if (raw.length !== expected) throw bad();
    const stride = width * channels, reconstructed = new Uint8Array(height * stride), pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]; if (filter > 4) throw bad();
        for (let x = 0; x < stride; x++) {
            const at = y * stride + x, left = x >= channels ? reconstructed[at - channels] : 0;
            const up = y ? reconstructed[at - stride] : 0, corner = y && x >= channels ? reconstructed[at - stride - channels] : 0;
            const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
            reconstructed[at] = raw[y * (stride + 1) + x + 1] + predictor;
        }
    }
    for (let pixel = 0; pixel < width * height; pixel++) {
        const from = pixel * channels, to = pixel * 4, gray = channels < 3;
        pixels[to] = reconstructed[from]; pixels[to + 1] = reconstructed[from + (gray ? 0 : 1)]; pixels[to + 2] = reconstructed[from + (gray ? 0 : 2)];
        pixels[to + 3] = channels === 2 || channels === 4 ? reconstructed[from + channels - 1] : 255;
    }
    return { width, height, data: pixels };
}

/** Decodes with bounded pixel/memory limits and emits one metadata-free opaque PNG. */
export async function normalizeImage(value: unknown) {
    const image = validateImage(value), bytes = Uint8Array.from(atob(image.base64), c => c.charCodeAt(0));
    if (image.mime === 'image/webp') throw new Error('Bitte wähle das WebP-Bild über die Bildauswahl aus, damit es sicher umgewandelt wird.');
    try {
        const decoded = image.mime === 'image/png' ? await decodePng(bytes)
            : decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true, tolerantDecoding: false, maxResolutionInMP: MAX_PIXELS / 1_000_000, maxMemoryUsageInMB: 32 });
        dimensions(decoded.width, decoded.height);
        for (let i = 0; i < decoded.data.length; i += 4) {
            const alpha = decoded.data[i + 3] / 255;
            for (let c = 0; c < 3; c++) decoded.data[i + c] = Math.round(decoded.data[i + c] * alpha + 255 * (1 - alpha));
            decoded.data[i + 3] = 255;
        }
        return await encodePng(decoded.data, decoded.width, decoded.height);
    } catch { throw bad(); }
}
