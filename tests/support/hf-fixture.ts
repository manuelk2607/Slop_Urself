import { HfConnections } from '../../src/auth/huggingface';

// Several profiles intentionally use one HF identity to exercise shared-account reservation safety.
export async function testHfPlayers(data: Map<string, unknown>, ids: string[]) {
    const config = { AUTH_COOKIE_SECRET: 'isolated-hf-fixture-key-at-least-32-characters', HF_OAUTH_CLIENT_ID: 'test-client' };
    const storage = { get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => data.delete(key) };
    const hf = new HfConnections(storage, config), original = globalThis.fetch;
    const players = [];
    try {
        globalThis.fetch = async input => {
            const url = String(input);
            if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'personal-test', token_type: 'Bearer', expires_in: 28800 });
            if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: 'shared-test', preferred_username: 'SharedTest' });
            if (url.endsWith('/api/whoami-v2')) return Response.json({ id: 'shared-test', name: 'SharedTest' });
            if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 720, current: 720, resetsAt: null });
            throw new Error('Unexpected HF fixture request');
        };
        for (const id of ids) {
            const account = { id, name: id, expiresAt: Date.now() + 60_000 };
            const start = await hf.start(account, 'https://test.invalid');
            const grant = await hf.finish(new URL(start.url).searchParams.get('state'), 'test-code', start.nonce, 'https://test.invalid');
            players.push({ id, accountId: id, hfConnectionId: grant.connection, sessionId: `session-${id}-1234567890`, connectionId: `conn-${id}`, name: id, connected: true, score: 0 });
        }
    } finally { globalThis.fetch = original; }
    return { config, storage, players };
}

export function heldHfVideos(data: Map<string, unknown>) {
    const holds = data.get('hf-budget:shared-test:reservations') as Record<string, { rounds: number }> | undefined;
    return Object.values(holds || {}).reduce((sum, hold) => sum + hold.rounds, 0);
}
