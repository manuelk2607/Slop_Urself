import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServerSentResult, extractVideoUrl, validateImage, orderProviderValues, buildProviderValues, generateAiVideo, resumeAiVideo, AiPendingError, AiExpiredError, AI_JOB_MAX_AGE_MS, type AiJob } from '../../src/ai/generation';
import { logAiEvent } from '../../src/ai/telemetry';
import { QuotaBudget } from '../../src/ai/quota';
import { qualityConfig } from '../../src/ai/providers';
import { testImageData } from '../support/images';
import { testModerationConfig, moderationFixture } from '../support/moderation-fixture';
import { testProviderConfig, testProviderMetadata, testProviderSettings } from '../support/provider-fixture';

const queueResult = (eventId: string, data: unknown[], error?: string) => new Response(`data: ${JSON.stringify({ msg: 'process_completed', event_id: eventId, success: !error, output: error ? { error } : { data } })}\n\n`);

test('SSE errors and intermediate events are not accepted as completed videos', () => {
    assert.throws(() => parseServerSentResult('event: error\ndata: "GPU quota exhausted"\n\n'), /abgebrochen/);
    assert.throws(() => parseServerSentResult('event: generating\ndata: ["preview.mp4"]\n\n'), /nicht abgeschlossen/);
    assert.deepEqual(parseServerSentResult('event: heartbeat\r\ndata: null\r\n\r\nevent: complete\r\ndata: ["video.mp4"]\r\n\r\n'), { data: ['video.mp4'] });
});

test('video file paths are converted to public HTTPS URLs', () => {
    assert.equal(extractVideoUrl({ data: [{ video: { path: '/tmp/video.mp4' } }] }, 'https://demo.hf.space'), 'https://demo.hf.space/gradio_api/file=/tmp/video.mp4');
    assert.throws(() => extractVideoUrl({ data: ['javascript:alert(1)'] }, 'https://demo.hf.space'));
});

test('generated file URLs keep the job replica without changing CDN URLs', () => {
    const root = 'https://demo.hf.space/--replicas/worker-123';
    const pinned = `${root}/gradio_api/file=/tmp/video.mp4`;
    assert.equal(extractVideoUrl({ data: [{ video: { path: '/tmp/video.mp4' } }] }, root), pinned);
    assert.equal(extractVideoUrl({ data: [{ url: 'https://demo.hf.space/gradio_api/file=/tmp/video.mp4' }] }, root), pinned);
    assert.equal(extractVideoUrl({ data: [pinned] }, root), pinned);
    assert.equal(extractVideoUrl({ data: ['video.mp4'] }, root), `${root}/video.mp4`);
    assert.equal(extractVideoUrl({ data: ['https://cdn.hf.co/video.mp4?token=example'] }, root), 'https://cdn.hf.co/video.mp4?token=example');
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

async function generateWithFakeSpace(seconds: number, fail = false, size?: { width: number; height: number }, rounds = 1, replica?: string) {
    const original = globalThis.fetch;
    const parameters = ['input_image', 'prompt', 'steps', 'duration_seconds', 'guidance_scale', 'frame_multiplier', 'safe_mode'].map(name => ({
        parameter_name: name, parameter_has_default: false, parameter_default: null, type: {}
    }));
    const calls: Record<string, unknown>[] = [], progress: string[] = [];
    const jobs: AiJob[] = [];
    const root = 'https://test.hf.space' + (replica && /^[a-z0-9][a-z0-9-]{0,79}$/.test(replica) ? `/--replicas/${replica}` : '');
    let uploads = 0, sessionHash = '';
    globalThis.fetch = async (input, init) => {
        const moderated = moderationFixture(input, init); if (moderated) return moderated;
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/whoami-v2')) return Response.json({ name: 'test' });
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: seconds, resetsAt: null, runs: { remaining: 7 } });
        if (url.startsWith('https://huggingface.co/api/spaces/Saravutw/')) return Response.json({ ...testProviderMetadata, host: 'https://test.hf.space' });
        if (url === 'https://test.hf.space/gradio_api/info') return Response.json({ named_endpoints: { '/generate_video': { parameters } } }, { headers: replica ? { 'x-proxied-replica': replica } : {} });
        if (url === `${root}/config`) return Response.json({ ...testProviderSettings, dependencies: [{ id: 17, api_name: 'generate_video' }] });
        if (url.endsWith('/gradio_api/upload')) { assert.equal(url, `${root}/gradio_api/upload`); uploads++; return Response.json(['/tmp/input.png']); }
        if (url.endsWith('/queue/join')) {
            assert.equal(url, `${root}/gradio_api/queue/join`);
            const { data, fn_index, session_hash } = JSON.parse(String(init?.body));
            assert.equal(fn_index, 17); assert.match(session_hash, /^[a-z0-9-]+$/); sessionHash = session_hash;
            calls.push(Object.fromEntries(parameters.map((p, i) => [p.parameter_name, data[i]])));
            return Response.json({ event_id: 'test-event' });
        }
        if (url.includes('/queue/data?session_hash=')) {
            assert.equal(url, `${root}/gradio_api/queue/data?session_hash=${sessionHash}`);
            if (fail) { seconds = 50; return queueResult('test-event', [], 'GPU failed'); }
            return queueResult('test-event', [{ video: { url: 'https://test.hf.space/video.mp4' } }]);
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    const data = new Map<string, any>();
    const config = qualityConfig({ ...testModerationConfig, ...testProviderConfig, HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx', AI_IMAGE_PROFILE: size ? 'bounded' : undefined });
    const budget = new QuotaBudget({ get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, config);
    try {
        await budget.reserve('TEST', rounds, 2); await budget.begin('TEST', rounds * 2);
        const input = size ? testImageData(size.width, size.height) : testImageData(1, 1);
        const costs: number[] = [];
        const video = generateAiVideo(input, 'Make this person jump off a boat', config, step => progress.push(step), cost => { costs.push(cost); return budget.allowAttempt('TEST', cost); }, { saveJob: async job => { jobs.push(structuredClone(job)); } });
        if (fail) await assert.rejects(video, /Alle kostenlosen/);
        else assert.equal(await video, `${root}/video.mp4`);
        assert.equal(uploads, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].duration_seconds, 5);
        assert.equal(calls[0].guidance_scale, 1);
        assert.equal(calls[0].frame_multiplier, 16);
        assert.equal(calls[0].safe_mode, false);
        assert.match(String(calls[0].prompt), /Make this person jump off a boat/);
        assert.equal((calls[0].input_image as any).path, '/tmp/input.png');
        return { calls, progress, costs, jobs };
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

test('uploads, submission, result polling and saved jobs use the same HF replica', async () => {
    const { jobs } = await generateWithFakeSpace(300, false, { width: 624, height: 832 }, 1, 'worker-123');
    assert.ok(jobs.length >= 3);
    assert.ok(jobs.every(job => job.root === 'https://test.hf.space/--replicas/worker-123'));
    assert.ok(jobs.every(job => job.sessionHash === jobs[0].sessionHash));
    assert.ok(jobs[0].sessionHash);
    assert.equal(jobs.at(-1)?.videoUrl, 'https://test.hf.space/--replicas/worker-123/video.mp4');
    assert.equal(await resumeAiVideo(jobs.at(-1)!, {}), jobs.at(-1)?.videoUrl);
});

test('untrusted replica headers cannot inject another origin or arbitrary path', async () => {
    const { jobs } = await generateWithFakeSpace(300, false, { width: 624, height: 832 }, 1, '../../evil');
    assert.ok(jobs.every(job => job.root === 'https://test.hf.space'));
    const running: AiJob = { ...jobs.at(-1)!, status: 'running', root: 'https://test.hf.space/--replicas/../evil' };
    await assert.rejects(resumeAiVideo(running, {}), /Ungültiger gespeicherter KI-Auftrag/);
    await assert.rejects(resumeAiVideo({ ...jobs.at(-1)!, sessionHash: 'invalid&query=secret' }, {}), /Ungültiger gespeicherter KI-Auftrag/);
});

test('bounded uploads use actual image costs while preserving the other three reserved five-second videos', async () => {
    const portrait = await generateWithFakeSpace(320, false, { width: 624, height: 832 }, 2);
    assert.equal(portrait.calls[0].steps, 4); assert.deepEqual(portrait.costs, [126, 79]);
    const square = await generateWithFakeSpace(300, false, { width: 640, height: 640 });
    assert.equal(square.calls[0].steps, 8); assert.deepEqual(square.costs, [100]);
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
        const moderated = moderationFixture(input, init); if (moderated) return moderated;
        const url = String(input);
        if (url.endsWith('/whoami-v2')) return Response.json({ name: 'test' });
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 720, current: 720, resetsAt: null, runs: { remaining: 8 } });
        if (url.includes('/api/spaces/')) return Response.json({ ...testProviderMetadata, host: 'https://test.hf.space' });
        if (url.endsWith('/info')) return Response.json({ named_endpoints: { '/generate_video': { parameters } } });
        if (url.endsWith('/config')) return Response.json({ ...testProviderSettings, dependencies: [{ id: 0, api_name: 'generate_video' }] });
        if (url.endsWith('/upload')) { uploads++; return Response.json(['/tmp/input.png']); }
        if (init?.method === 'POST') { posts++; return Response.json({ event_id: 'saved-event' }); }
        results++;
        if (results === 1) throw new Error('Network lost; secret-token must never be logged');
        return queueResult('saved-event', ['https://test.hf.space/video.mp4']);
    };
    const lifecycle = { saveJob: async (job: AiJob) => { checkpoints.push(structuredClone(job)); } };
    try {
        await assert.rejects(generateAiVideo(testImageData(1, 1), 'Private prompt', { ...testModerationConfig, ...testProviderConfig, HF_TOKEN: 'secret-token', AI_PROVIDER_CHAIN: 'wan22,wan22-fast' }, undefined, async () => { approvals++; }, lifecycle), AiPendingError);
        const saved = checkpoints.at(-1)!;
        assert.equal(saved.status, 'running'); assert.equal(saved.eventId, 'saved-event');
        assert.ok(saved.sessionHash);
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
        const moderated = moderationFixture(input, init); if (moderated) return moderated;
        const url = String(input);
        if (url.endsWith('/whoami-v2')) return Response.json({ name: 'test' });
        if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 720, current: 720, resetsAt: null });
        if (url.includes('/api/spaces/')) return Response.json({ ...testProviderMetadata, host: 'https://test.hf.space' });
        if (url.endsWith('/info')) return Response.json({ named_endpoints: { '/generate_video': { parameters } } });
        if (url.endsWith('/config')) return Response.json({ ...testProviderSettings, dependencies: [{ id: 0, api_name: 'generate_video' }] });
        if (url.endsWith('/upload')) return Response.json(['/tmp/input.png']);
        if (init?.method === 'POST') { posts++; throw new Error('POST response lost'); }
        throw new Error('Unexpected request');
    };
    try {
        await assert.rejects(generateAiVideo(testImageData(1, 1), 'wave', { ...testModerationConfig, ...testProviderConfig, HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' }, undefined, undefined, { saveJob: async job => { saved = structuredClone(job); } }), AiPendingError);
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
