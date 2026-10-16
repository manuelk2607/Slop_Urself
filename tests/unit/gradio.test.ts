import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GradioProviderError, readQueueResult } from '../../src/ai/gradio';

const frame = (message: unknown) => `data: ${JSON.stringify(message)}\n\n`;

test('queue completion is correlated, handles split frames and finishes without waiting for EOF', async () => {
    const text = frame({ msg: 'estimation', event_id: 'wanted' })
        + frame({ msg: 'process_completed', event_id: 'other', success: true, output: { data: ['wrong.mp4'] } })
        + frame({ msg: 'process_starts', event_id: 'wanted' })
        + frame({ msg: 'process_completed', event_id: 'wanted', success: true, output: { data: ['right.mp4'] } });
    let cancelled = false;
    const bytes = new TextEncoder().encode(text.replaceAll('\n', '\r\n'));
    const response = new Response(new ReadableStream({
        start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); },
        cancel() { cancelled = true; }
    }));
    const progress: string[] = [];
    assert.deepEqual(await readQueueResult(response, 'wanted', value => progress.push(value)), { data: ['right.mp4'] });
    assert.equal(cancelled, true);
    assert.match(progress[0], /GPU/); assert.match(progress[1], /berechnet/);
});

test('queue failures expose only fixed explanations, never upstream secrets or prompts', async () => {
    for (const [reason, code] of [['GPU quota exceeded', 'provider_quota'], ['ZeroGPU allocation failed', 'provider_gpu'], ['Unauthenticated request', 'provider_auth'], ['File not allowed', 'provider_input'], ['unexpected failure', 'provider_unclassified'], ['CUDA out of memory', 'provider_memory'], ['Queue full', 'provider_queue'], ['Worker restarting', 'provider_restart']]) {
        const response = new Response(frame({ msg: 'process_completed', event_id: 'wanted', success: false, output: { error: `${reason}: hf_secret private-prompt` } }));
        await assert.rejects(readQueueResult(response, 'wanted'), error => {
            assert.ok(error instanceof GradioProviderError); assert.equal(error.code, code);
            assert.doesNotMatch(error.message, /hf_secret|private-prompt/); return true;
        });
    }
});

test('queue previews, mismatched events and malformed terminal results cannot become videos', async () => {
    const incomplete = frame({ msg: 'process_generating', event_id: 'wanted', output: { data: ['preview.mp4'] } })
        + frame({ msg: 'process_completed', event_id: 'other', success: true, output: { data: ['other.mp4'] } });
    await assert.rejects(readQueueResult(new Response(incomplete), 'wanted'), /nicht abgeschlossen/);
    await assert.rejects(readQueueResult(new Response(frame({ msg: 'process_completed', event_id: 'wanted', success: true, output: {} })), 'wanted'), /kein Video/);
});

test('oversized or invalid queue frames fail closed', async () => {
    await assert.rejects(readQueueResult(new Response(`data: ${'x'.repeat(1024 * 1024 + 1)}`), 'wanted'), /Ergebnisstream/);
    await assert.rejects(readQueueResult(new Response('data: invalid-json\n\n'), 'wanted'), SyntaxError);
});
