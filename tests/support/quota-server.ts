export {};

// Replace only the quota endpoint. Generation requests fail instead of spending real GPU time.
const extensions = process.env.TEST_EXTRA_ROUNDS === 'true';
let seconds = extensions ? 300 : 185;
let remaining = 8;
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://huggingface.co/api/spaces/zero-gpu/quota') return Response.json({ base: extensions ? 300 : 720, current: seconds, resetsAt: null, runs: { remaining } });
    if (url.includes('huggingface.co') || url.includes('.hf.space')) throw new Error('Real AI calls are disabled in quota tests.');
    return original(input, options);
};
process.stdin.on('data', data => { seconds = Number(String(data).trim()); });
if (extensions) {
    require('../../dist/ai/generation.js').generateAiVideo = async (_image: string, _prompt: string, _config: unknown, _progress: unknown, allowAttempt: (seconds: number) => Promise<void>) => {
        await allowAttempt(92);
        await new Promise(resolve => setTimeout(resolve, 100));
        seconds = Math.max(0, seconds - 20); remaining--;
        return '/assets/mock-video.mp4';
    };
}
require('../../dist/server/node.js');
