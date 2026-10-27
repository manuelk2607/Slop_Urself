import { MAX_MEDIA_EDGE } from './media.js';

interface ContextImageProcessor {
    size?: { longest_edge?: number };
    max_image_size?: { longest_edge?: number };
    do_image_splitting?: boolean;
}
export function configureContextImages(value: unknown) {
    // The pinned SmolVLM defaults to 2048px even for our <=1024px media,
    // producing up to 17 tiles of mostly interpolated pixels. Keep all source
    // pixels and all tiles, but bound redundant upscaling to the accepted edge.
    // Model/code changes invalidate qualification; this is not a safety release.
    const processor = value as ContextImageProcessor | undefined;
    if (!processor || processor.size?.longest_edge !== 2048 || processor.max_image_size?.longest_edge !== 512 || processor.do_image_splitting !== true) {
        throw new Error('Unreviewed context image preprocessing');
    }
    processor.size = { longest_edge: MAX_MEDIA_EDGE };
}
