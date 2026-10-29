import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAiVideo, resumeAiVideo, AiPendingError, type AiJob } from '../../src/ai/generation';
import { approvedProvider, verifyPinnedProvider, ProviderTrustError } from '../../src/ai/provider-trust';
import { testProviderConfig, testProviderMetadata, testProviderSettings } from '../support/provider-fixture';
import { testModerationConfig, moderationFixture } from '../support/moderation-fixture';
import { testImageData } from '../support/images';

const root = 'https://test.hf.space';
const identity = approvedProvider(testProviderConfig);
const running = (): AiJob => ({ provider: 'wan22', providerIdentity: identity, root, endpoint: '/generate_video', eventId: 'event',
    status: 'running', submittedAt: Date.now(), seed: 1, steps: 8, durationSeconds: 5 });

test('saved provider roots must match the resolved Space and cannot carry credentials or path tricks', async () => {
    for (const bad of [root + '/', root + '?token=x', root + '/--replicas/../other', 'https://user@test.hf.space', 'https://other.hf.space']) {
        const calls: string[] = [];
        await assert.rejects(verifyPinnedProvider(identity, bad, async url => { calls.push(url); return { ...testProviderMetadata, host: root }; }), ProviderTrustError);
        assert.ok(calls.every(url => url.startsWith('https://huggingface.co/api/spaces/')), 'No personal credential may reach a foreign saved host.');
    }
    for (const id of ['../model', 'owner/..', './model', 'owner/.']) assert.throws(() => approvedProvider({ ...testProviderConfig, WAN_MODEL_ID: id }), ProviderTrustError);
    const calls: string[] = [];
    await verifyPinnedProvider(identity, root + '/--replicas/worker-1', async url => {
        calls.push(url); return url.includes('/api/spaces/') ? { ...testProviderMetadata, host: root } : testProviderSettings;
    });
    assert.equal(calls.at(-1), root + '/--replicas/worker-1/config');
});

test('model drift before polling or after a result retains the existing job without publication or resubmission', async () => {
    const original = globalThis.fetch;
    try {
        for (const drift of ['before', 'after', 'foreign'] as const) {
            const job = running(), saved: AiJob[] = [];
            let configs = 0, resultReads = 0;
            if (drift === 'foreign') job.root = 'https://foreign.hf.space';
            globalThis.fetch = async (input, options) => {
                const url = String(input); assert.equal(options?.redirect, 'manual'); assert.notEqual(options?.method, 'POST');
                assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer personal-fixture');
                if (url.includes('/api/spaces/')) return Response.json({ ...testProviderMetadata, host: root });
                assert.ok(url.startsWith(root + '/'), 'Never contact the foreign saved host');
                if (url.endsWith('/config')) { configs++; return Response.json(drift === 'before' || configs > 1 ? {} : testProviderSettings); }
                resultReads++; return new Response('event: complete\ndata: ["video.mp4"]\n\n');
            };
            await assert.rejects(resumeAiVideo(job, { HF_TOKEN: 'personal-fixture' }, undefined, { saveJob: async value => { saved.push(value); } }),
                error => error instanceof AiPendingError && error.job === job);
            assert.equal(resultReads, drift === 'after' ? 1 : 0);
            assert.equal(saved.length, 0, 'Do not mark a result complete/failed or release its uncertain budget on trust failure.');
        }
    } finally { globalThis.fetch = original; }
});

test('a deployment during upload or malformed upload output cannot submit any GPU job', async () => {
    const original = globalThis.fetch;
    try {
        for (const scenario of ['drift', 'multiple-files', 'control-character', 'oversize'] as const) {
            let uploads = 0, configs = 0, posts = 0;
            const parameters = ['input_image', 'prompt', 'steps', 'duration_seconds'].map(parameter_name => ({ parameter_name, parameter_has_default: false, type: {} }));
            globalThis.fetch = async (input, options) => {
                const moderated = moderationFixture(input, options); if (moderated) return moderated;
                const url = String(input);
                if (url.endsWith('/whoami-v2')) return Response.json({ name: 'fixture' });
                assert.equal(options?.redirect, 'manual');
                if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: 300, resetsAt: null });
                if (url.includes('/api/spaces/')) return Response.json({ ...testProviderMetadata, host: root });
                if (url.endsWith('/info')) return Response.json({ named_endpoints: { '/generate_video': { parameters } } });
                if (url.endsWith('/config')) {
                    configs++;
                    return Response.json({ ...(scenario === 'drift' && configs > 1 ? {} : testProviderSettings), dependencies: [{ id: 1, api_name: 'generate_video' }] });
                }
                if (url.endsWith('/upload')) {
                    uploads++;
                    return Response.json(scenario === 'multiple-files' ? ['/tmp/a.png', '/tmp/b.png'] : [scenario === 'control-character' ? '/tmp/a\n.png' : scenario === 'oversize' ? 'x'.repeat(17_000) : '/tmp/a.png']);
                }
                posts++; throw new Error('GPU submission must never happen');
            };
            await assert.rejects(generateAiVideo(testImageData(1, 1), 'A tree waves in the wind', {
                ...testModerationConfig, ...testProviderConfig, HF_TOKEN: 'personal-fixture', AI_PROVIDER_CHAIN: 'wan22'
            }));
            assert.equal(uploads, 1); assert.equal(posts, 0);
        }
    } finally { globalThis.fetch = original; }
});

test('malformed submission IDs preserve the uncertain submitting job and never submit a second generation', async () => {
    const original = globalThis.fetch;
    try {
        for (const event_id of [42, {}, '', 'x'.repeat(121), 'path/escape', 'id\nnext', null]) {
            const saved: AiJob[] = []; let posts = 0;
            const parameters = ['input_image', 'prompt', 'steps', 'duration_seconds'].map(parameter_name => ({ parameter_name, parameter_has_default: false, type: {} }));
            globalThis.fetch = async (input, options) => {
                const moderated = moderationFixture(input, options); if (moderated) return moderated;
                const url = String(input);
                if (url.endsWith('/whoami-v2')) return Response.json({ name: 'fixture' });
                if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: 300, resetsAt: null });
                if (url.includes('/api/spaces/')) return Response.json({ ...testProviderMetadata, host: root });
                if (url.endsWith('/info')) return Response.json({ named_endpoints: { '/generate_video': { parameters } } });
                if (url.endsWith('/config')) return Response.json({ ...testProviderSettings, dependencies: [{ id: 1, api_name: 'generate_video' }] });
                if (url.endsWith('/upload')) return Response.json(['/tmp/a.png']);
                assert.ok(url.endsWith('/queue/join')); posts++; return Response.json({ event_id });
            };
            await assert.rejects(generateAiVideo(testImageData(1, 1), 'A tree waves in the wind', {
                ...testModerationConfig, ...testProviderConfig, HF_TOKEN: 'personal-fixture', AI_PROVIDER_CHAIN: 'wan22,wan22-fast'
            }, undefined, undefined, { saveJob: async value => { saved.push(structuredClone(value)); } }), AiPendingError);
            assert.equal(saved.length, 1); assert.equal(saved[0].status, 'submitting'); assert.equal(saved[0].eventId, undefined);
            await assert.rejects(resumeAiVideo(saved[0], { HF_TOKEN: 'personal-fixture' }), AiPendingError);
            assert.equal(posts, 1, 'Neither a fallback nor resume may resubmit the uncertain job.');
        }
    } finally { globalThis.fetch = original; }
});
