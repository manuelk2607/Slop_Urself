export {};
// Deterministic slow mock for status/reload UI, never external inference.
import type { AiProgress } from '../../src/shared/generation';
let calls = 0;
require('../../dist/ai/generation.js').generateAiVideo = async (_image: string, _prompt: string, _config: unknown, progress: AiProgress) => {
    if (++calls !== 1) throw new Error('Reload must not submit another video');
    progress('fixture queue', 'queue');
    await new Promise(resolve => setTimeout(resolve, 8000));
    progress('fixture inference', 'inference');
    await new Promise(resolve => setTimeout(resolve, 1500));
    return '/assets/mock-video.mp4';
};
require('../../dist/server/node.js');
