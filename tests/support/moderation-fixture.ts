import type { ModerationConfig } from '../../src/security/moderation';
export const testModerationConfig = {
    MODERATION_URL: 'https://moderation.test/validate', MODERATION_SECRET: 'isolated-test-moderation-secret-at-least-32',
    MODERATION_POLICY_VERSION: 'test-policy-v1', MODERATION_MODEL_VERSION: 'test-only-never-deploy'
} satisfies ModerationConfig;
// Only a protocol fixture. No content protection is claimed or evaluated here.
export function moderationFixture(input: string | URL | Request, init?: RequestInit) {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== testModerationConfig.MODERATION_URL) return;
    return Response.json({ decision: 'allow', digest: new Headers(init?.headers).get('x-content-sha256'),
        policyVersion: testModerationConfig.MODERATION_POLICY_VERSION, modelVersion: testModerationConfig.MODERATION_MODEL_VERSION,
        decodeComplete: true, durationSeconds: 5, codec: 'h264', pixelFormat: 'yuv420p', frameCount: 81, framesChecked: 81 });
}
