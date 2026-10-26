export {};

import { testModerationConfig, moderationFixture } from './moderation-fixture';
import { testProviderConfig } from './provider-fixture';
Object.assign(process.env, testModerationConfig, testProviderConfig);
const seconds: Record<string, number> = { central: 75, 'hf-a': 300, 'hf-b': 300 };
const original = globalThis.fetch;
let devices = 0;
globalThis.fetch = async (input, options) => {
    const moderated = moderationFixture(input, options); if (moderated) return moderated;
    const url = String(input instanceof Request ? input.url : input), token = new Headers(options?.headers).get('authorization')?.replace('Bearer ', '') || '';
    if (url.startsWith('https://storage.test/') && url.includes('list-type')) return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
    if (url === 'https://huggingface.co/oauth/device') {
        const code = devices++ === 0 ? 'hf-a' : 'hf-b';
        return Response.json({ device_code: code, user_code: code === 'hf-a' ? 'ABCD-1234' : 'EFGH-5678', verification_uri: 'https://huggingface.co/oauth/device', expires_in: 300, interval: 5 });
    }
    if (url === 'https://huggingface.co/oauth/token') {
        const params = new URLSearchParams(String(options?.body));
        const code = params.get('device_code') || params.get('code');
        if (!['hf-a', 'hf-b'].includes(code || '')) return new Response(null, { status: 400 });
        return Response.json({ access_token: code, token_type: 'Bearer', expires_in: 28800 });
    }
    if (url.startsWith('https://huggingface.co/')) {
        if (!(token in seconds)) return new Response(null, { status: 401 });
        if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: token, preferred_username: token });
        if (url.endsWith('/api/whoami-v2')) return Response.json({ id: token, name: token });
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: seconds[token], resetsAt: null, runs: { remaining: 8 } });
        throw new Error('No real HF requests allowed in personal quota tests');
    }
    return original(input, options);
};
require('../../dist/ai/generation.js').generateAiVideo = async (_image: string, _prompt: string, config: { HF_TOKEN?: string }, _progress: unknown, allowAttempt: (seconds: number) => Promise<void>) => {
    const token = config.HF_TOKEN;
    if (!token || !['hf-a', 'hf-b'].includes(token)) throw new Error('Generation did not use its creator\'s personal HF token');
    await allowAttempt(79);
    seconds[token] -= 70;
    await new Promise(resolve => setTimeout(resolve, 50));
    return '/assets/mock-video.mp4';
};
// This suite checks personal identity/quota, not real inference or archival.
require('../../dist/storage/archive.js').archiveVideo = async () => '/assets/mock-video.mp4';
require('../../dist/server/node.js');
