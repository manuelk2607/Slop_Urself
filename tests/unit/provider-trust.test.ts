import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedProvider, verifyProviderIdentity, verifyWanParameters } from '../../src/ai/provider-trust';
import { testProviderConfig, testProviderMetadata, testProviderSettings } from '../support/provider-fixture';
import { archiveRecovery } from '../../src/ai/recovery';
import { AiPendingError, AI_JOB_MAX_AGE_MS, type AiJob } from '../../src/ai/generation';
import { ModerationError } from '../../src/security/moderation';
test('provider release requires fixed source, matching running revision and declared model revision', () => {
    assert.throws(() => approvedProvider({}));
    assert.throws(() => approvedProvider({ ...testProviderConfig, WAN_SPACE_REVISION: 'main' }));
    const identity = verifyProviderIdentity(testProviderConfig, testProviderMetadata, testProviderSettings);
    assert.equal(identity.modelId, testProviderConfig.WAN_MODEL_ID);
    for (const metadata of [{}, { ...testProviderMetadata, sha: 'x'.repeat(40) }, { ...testProviderMetadata, runtime: {} }]) assert.throws(() => verifyProviderIdentity(testProviderConfig, metadata, testProviderSettings));
    assert.throws(() => verifyProviderIdentity(testProviderConfig, testProviderMetadata, {}));
    assert.throws(() => verifyProviderIdentity(testProviderConfig, testProviderMetadata, { slop_model: { id: 'other/model', revision: testProviderConfig.WAN_MODEL_REVISION } }));
});
test('archive outages retry completed jobs without allowing a new generation; blocked output stays blocked', () => {
    const job: AiJob = { provider: 'wan22', root: 'https://example.hf.space', endpoint: '/generate_video', submittedAt: Date.now(), status: 'complete', seed: 1, steps: 8, durationSeconds: 5, videoUrl: 'https://example.hf.space/result.mp4' };
    const error = new Error('storage down');
    const retry = archiveRecovery(error, job); assert.ok(retry instanceof AiPendingError); assert.equal(retry.job, job);
    assert.ok(archiveRecovery(new ModerationError('moderation_unavailable', 'offline'), job) instanceof AiPendingError);
    const blocked = new ModerationError('content_blocked', 'blocked'); assert.equal(archiveRecovery(blocked, job), blocked);
    assert.equal(archiveRecovery(error, { ...job, status: 'running' }), error);
    assert.equal(archiveRecovery(error, job, job.submittedAt + AI_JOB_MAX_AGE_MS), error);
});

test('Wan API cannot silently inherit unknown model selectors, duplicate names or missing image inputs', () => {
    const values = { input_image: null, prompt: 'wave', steps: 8, duration_seconds: 5 };
    const parameters = Object.keys(values).map(parameter_name => ({ parameter_name, parameter_has_default: false }));
    verifyWanParameters(parameters, values);
    assert.throws(() => verifyWanParameters([...parameters, { parameter_name: 'model_choice', parameter_has_default: true }], values));
    assert.throws(() => verifyWanParameters([...parameters, parameters[0]], values));
    assert.throws(() => verifyWanParameters(parameters.slice(1), values));
    assert.throws(() => verifyWanParameters(null, values));
});
