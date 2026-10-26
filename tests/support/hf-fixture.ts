import { HfConnections } from '../../src/auth/huggingface';

// Several profiles intentionally use one HF identity to exercise shared-account reservation safety.
export async function testHfPlayers(data: Map<string, unknown>, ids: string[], distinct = false) {
    const config = { AUTH_COOKIE_SECRET: 'isolated-hf-fixture-key-at-least-32-characters', HF_OAUTH_CLIENT_ID: 'test-client' };
    const storage = { get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => data.delete(key) };
    const hf = new HfConnections(storage, config), original = globalThis.fetch;
    const players = [];
    let subject = 'shared-test';
    let token = 'personal-test';
    const tokenSubjects = new Map<string, string>();
    try {
        globalThis.fetch = async (input, init) => {
            const url = String(input);
            const actualSubject = tokenSubjects.get(new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') || '');
            if (url.endsWith('/oauth/token')) return Response.json({ access_token: token, token_type: 'Bearer', expires_in: 28800 });
            if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: actualSubject, preferred_username: 'SharedTest' });
            if (url.endsWith('/api/whoami-v2')) return Response.json({ id: actualSubject, name: 'SharedTest' });
            if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 720, current: 720, resetsAt: null });
            throw new Error('Unexpected HF fixture request');
        };
        for (const id of ids) {
            subject = distinct ? `hf-${id}` : 'shared-test';
            token = distinct ? `personal-test-${id}` : 'personal-test'; tokenSubjects.set(token, subject);
            const account = { id, name: id, expiresAt: Date.now() + 60_000, identityProof: 'owner' as const };
            const start = await hf.start(account, 'https://test.invalid');
            const grant = await hf.finish(new URL(start.url).searchParams.get('state'), 'test-code', start.nonce, 'https://test.invalid');
            players.push({ id, accountId: id, hfConnectionId: grant.connection, sessionId: `session-${id}-1234567890`, connectionId: `conn-${id}`, name: id, connected: true, score: 0 });
        }
    } finally { globalThis.fetch = original; }
    return { config, storage, players };
}

export function heldHfVideos(data: Map<string, unknown>) {
    return [...data.entries()].filter(([key]) => /^hf-budget:.*:reservations$/.test(key))
        .flatMap(([, holds]) => Object.values(holds as Record<string, { rounds: number }>))
        .reduce((sum, hold) => sum + hold.rounds, 0);
}
