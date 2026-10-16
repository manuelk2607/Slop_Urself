export async function prepareImage(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Bitte wähle ein PNG-, JPEG- oder WebP-Bild bis 8 MB.');
    const url = URL.createObjectURL(file), image = new Image();
    try {
        image.src = url; await image.decode();
        const w = image.naturalWidth, h = image.naturalHeight;
        if (!w || !h || w * h > 40_000_000) throw new Error('Die Bildabmessungen sind zu groß.');
        const [width, height] = w === h ? [640, 640] : w > h ? [832, 624] : [624, 832];
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#000000'; context.fillRect(0, 0, width, height);
        const scale = Math.min(width / w, height / h);
        context.drawImage(image, (width - w * scale) / 2, (height - h * scale) / 2, w * scale, h * scale);
        return canvas.toDataURL('image/jpeg', 0.92);
    } finally { URL.revokeObjectURL(url); }
}
