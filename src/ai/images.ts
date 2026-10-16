import { imageSize } from 'image-size';

export const BOUNDED_IMAGE_SIZES = [[832, 624], [624, 832], [640, 640]] as const;
export function preparedImageSize(base64: string) {
    try {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const size = imageSize(bytes);
        if (!BOUNDED_IMAGE_SIZES.some(([width, height]) => width === size.width && height === size.height)) throw new Error();
        return { width: size.width, height: size.height };
    } catch { throw new Error('Das Bild muss neu vorbereitet werden. Bitte lade die Seite neu und wähle das Bild erneut aus.'); }
}
