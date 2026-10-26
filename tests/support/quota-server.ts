export {};
import { testModerationConfig, moderationFixture } from './moderation-fixture';
import { testProviderConfig } from './provider-fixture';
Object.assign(process.env, testModerationConfig, testProviderConfig);

// Replace only the quota endpoint. Generation requests fail instead of spending real GPU time.
const extensions = process.env.TEST_EXTRA_ROUNDS === 'true';
let seconds = extensions ? 300 : 185;
let remaining = 8;
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
    const moderated = moderationFixture(input, options); if (moderated) return moderated;
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://storage.test/') && url.includes('list-type')) return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
    if (url === 'https://huggingface.co/oauth/token') return Response.json({ access_token: 'personal-test', token_type: 'Bearer', expires_in: 28800 });
    const token = new Headers(options?.headers).get('authorization');
    if (url.startsWith('https://huggingface.co/') && token !== 'Bearer personal-test') throw new Error('The server token must never be used');
    if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: 'shared-test', preferred_username: 'SharedTest' });
    if (url.endsWith('/api/whoami-v2')) return Response.json({ id: 'shared-test', name: 'SharedTest' });
    if (url === 'https://huggingface.co/api/spaces/zero-gpu/quota') return Response.json({ base: extensions ? 300 : 720, current: seconds, resetsAt: null, runs: { remaining } });
    if (url.includes('huggingface.co') || url.includes('.hf.space')) throw new Error('Real AI calls are disabled in quota tests.');
    return original(input, options);
};
process.stdin.on('data', data => { seconds = Number(String(data).trim()); });
if (extensions) {
    require('../../dist/storage/archive.js').archiveVideo = async () => '/assets/mock-video.mp4';
    require('../../dist/ai/generation.js').generateAiVideo = async (_image: string, _prompt: string, _config: unknown, _progress: unknown, allowAttempt: (seconds: number) => Promise<void>) => {
        await allowAttempt(70);
        await new Promise(resolve => setTimeout(resolve, 100));
        seconds = Math.max(0, seconds - 20); remaining--;
        return '/assets/mock-video.mp4';
    };
}
require('../../dist/server/node.js');
