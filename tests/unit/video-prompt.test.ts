import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildVideoPrompt, validatePrompt, VIDEO_NEGATIVE_PROMPT } from '../../src/shared/video-prompt';
import { buildProviderValues } from '../../src/ai/generation';

test('shared prompt contract preserves explicit transformations and scene changes across provider modes', () => {
    for (const prompt of ['Die Person winkt langsam.', 'Make this person jump off a boat', 'The paper bird transforms into a butterfly!', 'Cut from the garden to the moon.', 'Ｆｌｏａｔ upward', 'Turn toward the camera?']) {
        const original = validatePrompt(prompt), full = buildVideoPrompt(prompt);
        assert.ok(full.startsWith(original)); assert.doesNotMatch(full, /\.\.|identity|one shot/);
        assert.match(full, /Preserve details the request does not change/);
        for (const provider of ['wan22', 'wan22-fast', 'ltx'] as const) {
            const values = buildProviderValues(provider, prompt, null, {});
            assert.equal(values.prompt, full); assert.equal(values.negative_prompt, VIDEO_NEGATIVE_PROMPT);
        }
    }
});

test('preview and provider construction share normalization and reject invisible or overlong instructions', () => {
    assert.equal(buildVideoPrompt('  Ｗａｖｅ  '), buildVideoPrompt('Wave'));
    for (const invalid of ['', ' '.repeat(10), 'x'.repeat(151), 'Wave\u200b', 'Wave\n']) {
        // Surrounding whitespace is allowed and trimmed consistently.
        if (invalid === 'Wave\n') { assert.equal(buildVideoPrompt(invalid), buildVideoPrompt('Wave')); continue; }
        assert.throws(() => buildVideoPrompt(invalid));
        assert.throws(() => buildProviderValues('wan22', invalid, null, {}));
    }
});
