export async function boundedJson(request: Request, limit: number): Promise<unknown> {
    if (Number(request.headers.get('content-length')) > limit) {
        await request.body?.cancel(); throw new RangeError('Die Anfrage ist zu groß.');
    }
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Ungültige Anfrage.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) { await reader.cancel(); throw new RangeError('Die Anfrage ist zu groß.'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}
