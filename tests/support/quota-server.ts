export {};
import { testModerationConfig, moderationFixture } from './moderation-fixture';
import { testProviderConfig } from './provider-fixture';
Object.assign(process.env, testModerationConfig, testProviderConfig);

// Replace only the quota endpoint. Generation requests fail instead of spending real GPU time.
const extensions = process.env.TEST_EXTRA_ROUNDS === 'true';
let seconds = extensions ? 300 : 185;
const accounts = new Map<string, { seconds: number; remaining: number }>();
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
    const moderated = moderationFixture(input, options); if (moderated) return moderated;
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://storage.test/') && url.includes('list-type')) return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
    if (url === 'https://huggingface.co/oauth/token') {
        const token = new URLSearchParams(String(options?.body)).get('code') || '';
        if (!token.startsWith('fixture-')) throw new Error('Only isolated test authorization codes are allowed');
        if (!accounts.has(token)) accounts.set(token, { seconds: !extensions && accounts.size === 2 ? 0 : seconds, remaining: extensions ? 4 : 8 });
        return Response.json({ access_token: token, token_type: 'Bearer', expires_in: 28800 });
    }
    const token = new Headers(options?.headers).get('authorization')?.replace('Bearer ', '') || '';
    const account = accounts.get(token);
    if (url.startsWith('https://huggingface.co/') && !account) throw new Error('The server token must never be used');
    if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: token, preferred_username: 'QuotaTest' });
    if (url.endsWith('/api/whoami-v2')) return Response.json({ id: token, name: 'QuotaTest' });
    if (url === 'https://huggingface.co/api/spaces/zero-gpu/quota') return Response.json({ base: extensions ? 300 : 720, current: account!.seconds, resetsAt: null, runs: { remaining: account!.remaining } });
    if (url.includes('huggingface.co') || url.includes('.hf.space')) throw new Error('Real AI calls are disabled in quota tests.');
    return original(input, options);
};
process.stdin.on('data', data => { seconds = Number(String(data).trim()); for (const account of accounts.values()) account.seconds = seconds; });
if (extensions) {
    require('../../dist/storage/archive.js').archiveVideo = async () => '/assets/mock-video.mp4';
    require('../../dist/ai/generation.js').generateAiVideo = async (_image: string, _prompt: string, config: { HF_TOKEN?: string }, _progress: unknown, allowAttempt: (seconds: number) => Promise<void>) => {
        const account = accounts.get(config.HF_TOKEN || '');
        if (!account) throw new Error('Video did not use an individual test token');
        await allowAttempt(70);
        await new Promise(resolve => setTimeout(resolve, 100));
        account.seconds = Math.max(0, account.seconds - 20); account.remaining--;
        return '/assets/mock-video.mp4';
    };
}
require('../../dist/server/node.js');
