import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServerSentResult, extractVideoUrl, validateImage, orderProviderValues, buildProviderValues, generateAiVideo, resumeAiVideo, AiPendingError, AiExpiredError, AI_JOB_MAX_AGE_MS, type AiJob } from '../ai';
import { logAiEvent } from '../telemetry';
import { QuotaBudget } from '../quota';

test('SSE errors and intermediate events are not accepted as completed videos', () => {
    assert.throws(() => parseServerSentResult('event: error\ndata: "GPU quota exhausted"\n\n'), /abgebrochen/);
    assert.throws(() => parseServerSentResult('event: generating\ndata: ["preview.mp4"]\n\n'), /nicht abgeschlossen/);
    assert.deepEqual(parseServerSentResult('event: heartbeat\r\ndata: null\r\n\r\nevent: complete\r\ndata: ["video.mp4"]\r\n\r\n'), { data: ['video.mp4'] });
});

test('video file paths are converted to public HTTPS URLs', () => {
    assert.equal(extractVideoUrl({ data: [{ video: { path: '/tmp/video.mp4' } }] }, 'https://demo.hf.space'), 'https://demo.hf.space/gradio_api/file=/tmp/video.mp4');
    assert.throws(() => extractVideoUrl({ data: ['javascript:alert(1)'] }, 'https://demo.hf.space'));
});

test('invalid images are rejected before uploading even in mock mode', () => {
    assert.throws(() => validateImage('not an image'));
    assert.throws(() => validateImage('data:image/png;base64,SGVsbG8='));
    assert.throws(() => validateImage('data:image/svg+xml;base64,PHN2Zz4='));
});

test('provider values are bound by actual API names and require at least five seconds', () => {
    const parameters = ['steps', 'duration_seconds', 'seed', 'scheduler', 'frame_multiplier'].map(name => ({
        parameter_name: name, parameter_has_default: false, parameter_default: null, type: {}
    }));
    const values = buildProviderValues('wan22', 'A person waves', {}, {});
    const ordered = orderProviderValues(parameters, values);
    assert.equal(ordered[0], 8); assert.equal(ordered[1], 5);
    assert.equal(ordered[3], 'UniPCMultistep'); assert.equal(ordered[4], 16);
    const fast = orderProviderValues(parameters, buildProviderValues('wan22-fast', 'A person waves', {}, {}));
    assert.equal(fast[0], 4); assert.equal(fast[1], 5);
    assert.throws(() => orderProviderValues([{ ...parameters[1], type: { description: 'numeric value between 0.3 and 3.4' } }], values));
});

async function generateWithFakeSpace(seconds: number, fail = false) {
    const original = globalThis.fetch;
    const parameters = ['input_image', 'prompt', 'steps', 'duration_seconds', 'guidance_scale', 'frame_multiplier', 'safe_mode'].map(name => ({
        parameter_name: name, parameter_has_default: false, parameter_default: null, type: {}
    }));
    const calls: Record<string, unknown>[] = [], progress: string[] = [];
    let uploads = 0;
    globalThis.fetch = async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/whoami-v2')) return Response.json({ name: 'test' });
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: seconds, resetsAt: null, runs: { remaining: 7 } });
        if (url.startsWith('https://huggingface.co/api/spaces/Saravutw/')) return Response.json({ host: 'https://test.hf.space' });
        if (url === 'https://test.hf.space/gradio_api/info') return Response.json({ named_endpoints: { '/generate_video': { parameters } } });
        if (url.endsWith('/gradio_api/upload')) { uploads++; return Response.json(['/tmp/input.png']); }
        if (url.endsWith('/call/generate_video')) {
            const { data } = JSON.parse(String(init?.body));
            calls.push(Object.fromEntries(parameters.map((p, i) => [p.parameter_name, data[i]])));
            return Response.json({ event_id: 'test-event' });
        }
        if (url.endsWith('/call/generate_video/test-event')) {
            if (fail) { seconds = 50; return new Response('event: error\ndata: "GPU failed"\n\n'); }
            return new Response('event: complete\ndata: [{"video":{"url":"https://test.hf.space/video.mp4"}}]\n\n');
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    const data = new Map<string, any>();
    const config = { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' };
    const budget = new QuotaBudget({ get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, config);
    try {
        await budget.reserve('TEST', 1, 2); await budget.begin('TEST', 2);
        const video = generateAiVideo('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7VQAAAAASUVORK5CYII=', 'Make this person jump off a boat', config, step => progress.push(step), cost => budget.allowAttempt('TEST', cost));
        if (fail) await assert.rejects(video, /Alle kostenlosen/);
        else assert.equal(await video, 'https://test.hf.space/video.mp4');
        assert.equal(uploads, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].duration_seconds, 5);
        assert.equal(calls[0].guidance_scale, 1);
        assert.equal(calls[0].frame_multiplier, 16);
        assert.equal(calls[0].safe_mode, false);
        assert.match(String(calls[0].prompt), /Make this person jump off a boat/);
        assert.equal((calls[0].input_image as any).path, '/tmp/input.png');
        return { calls, progress };
    } finally { globalThis.fetch = original; }
}

test('185 seconds route actual I2V parameters to native four-step mode and preserve five seconds', async () => {
    const { calls, progress } = await generateWithFakeSpace(185);
    assert.equal(calls[0].steps, 4);
    assert.match(progress[0], /Sparmodus/);
});

test('eight-step mode remains preferred when every player has sufficient reserved budget', async () => {
    const { calls, progress } = await generateWithFakeSpace(300);
    assert.equal(calls[0].steps, 8);
    assert.match(progress[0], /8 Schritte/);
});

test('failed generations recheck the shared quota before uploading to another fallback', async () => {
    const { calls } = await generateWithFakeSpace(185, true);
    assert.equal(calls[0].steps, 4);
});

test('connection failure resumes the saved result instead of uploading or generating another video', async () => {
    const original = globalThis.fetch;
    let posts = 0, results = 0, uploads = 0, approvals = 0;
    const checkpoints: AiJob[] = [];
    const parameters = ['input_image', 'prompt', 'steps', 'duration_seconds', 'seed'].map(parameter_name => ({ parameter_name, parameter_has_default: false, parameter_default: null, type: {} }));
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/whoami-v2')) return Response.json({ name: 'test' });
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 720, current: 720, resetsAt: null, runs: { remaining: 8 } });
        if (url.includes('/api/spaces/')) return Response.json({ host: 'https://test.hf.space' });
        if (url.endsWith('/info')) return Response.json({ named_endpoints: { '/generate_video': { parameters } } });
        if (url.endsWith('/upload')) { uploads++; return Response.json(['/tmp/input.png']); }
        if (init?.method === 'POST') { posts++; return Response.json({ event_id: 'saved-event' }); }
        results++;
        if (results === 1) throw new Error('Network lost; secret-token must never be logged');
        return new Response('event: complete\ndata: ["https://test.hf.space/video.mp4"]\n\n');
    };
    const lifecycle = { saveJob: async (job: AiJob) => { checkpoints.push(structuredClone(job)); } };
    try {
        await assert.rejects(generateAiVideo('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7VQAAAAASUVORK5CYII=', 'Private prompt', { HF_TOKEN: 'secret-token', AI_PROVIDER_CHAIN: 'wan22,wan22-fast' }, undefined, async () => { approvals++; }, lifecycle), AiPendingError);
        const saved = checkpoints.at(-1)!;
        assert.equal(saved.status, 'running'); assert.equal(saved.eventId, 'saved-event');
        assert.equal(JSON.stringify(saved).includes('Private prompt'), false);
        assert.equal(JSON.stringify(saved).includes('secret-token'), false);
        assert.equal(await resumeAiVideo(saved, { HF_TOKEN: 'secret-token' }, undefined, lifecycle), 'https://test.hf.space/video.mp4');
        assert.equal(posts, 1); assert.equal(uploads, 1); assert.equal(approvals, 1); assert.equal(results, 2);
        assert.equal(checkpoints.at(-1)?.status, 'complete');
        await resumeAiVideo(checkpoints.at(-1)!, {}, undefined, lifecycle);
        assert.equal(results, 2, 'An archived/completed result never starts a new HF request.');
    } finally { globalThis.fetch = original; }
});

test('ambiguous submissions and expired jobs never blindly start a fallback', async () => {
    const original = globalThis.fetch;
    let posts = 0;
    let saved!: AiJob;
    const parameters = ['input_image', 'prompt', 'steps', 'duration_seconds', 'seed'].map(parameter_name => ({ parameter_name, parameter_has_default: false, parameter_default: null, type: {} }));
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/whoami-v2')) return Response.json({ name: 'test' });
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 720, current: 720, resetsAt: null });
        if (url.includes('/api/spaces/')) return Response.json({ host: 'https://test.hf.space' });
        if (url.endsWith('/info')) return Response.json({ named_endpoints: { '/generate_video': { parameters } } });
        if (url.endsWith('/upload')) return Response.json(['/tmp/input.png']);
        if (init?.method === 'POST') { posts++; throw new Error('POST response lost'); }
        throw new Error('Unexpected request');
    };
    try {
        await assert.rejects(generateAiVideo('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7VQAAAAASUVORK5CYII=', 'wave', { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' }, undefined, undefined, { saveJob: async job => { saved = structuredClone(job); } }), AiPendingError);
        assert.equal(saved.status, 'submitting'); assert.equal(saved.eventId, undefined);
        await assert.rejects(resumeAiVideo(saved, {}), AiPendingError);
        await assert.rejects(resumeAiVideo({ ...saved, submittedAt: Date.now() - AI_JOB_MAX_AGE_MS }, {}), AiExpiredError);
        assert.equal(posts, 1);
    } finally { globalThis.fetch = original; }
});

test('telemetry only records technical fields and never remote error bodies', () => {
    const original = console.info, logs: string[] = [];
    console.info = message => logs.push(String(message));
    try {
        logAiEvent('failed', { provider: 'wan22', errorCode: 'http_503', prompt: 'private-prompt', token: 'secret-token', image: 'private-image' } as any);
        const entry = JSON.parse(logs[0]); assert.equal(entry.provider, 'wan22'); assert.equal(entry.errorCode, 'http_503');
        assert.doesNotMatch(logs[0], /private|secret/);
        assert.throws(() => parseServerSentResult('event: error\ndata: "secret-token private-prompt"\n\n'), error => error instanceof Error && !/secret|private/.test(error.message));
    } finally { console.info = original; }
});
