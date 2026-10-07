import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomDurableObject, ServiceDurableObject, Env } from '../../src/server/cloudflare/worker';
import { AI_JOB_MAX_AGE_MS, type AiJob } from '../../src/ai/generation';
import { Room } from '../../src/game/rules';

class TestSocket {
    messages: { type: string; payload: any }[] = [];
    closed = false;
    constructor(public attachment: any) {}
    send(data: string) { this.messages.push(JSON.parse(data)); }
    close() { this.closed = true; }
    serializeAttachment(value: unknown) { this.attachment = value; }
    deserializeAttachment() { return this.attachment; }
}

async function fixture(stateName: Room['state'] = 'VOTING', overrides: Partial<Env> = {}, rounds = 1, initial: Partial<Room> = {}) {
    const players = ['a', 'b', 'c'].map(id => ({ id, sessionId: `session-${id}-1234567890`, name: id, score: 0, connected: true, connectionId: `conn-${id}` }));
    const room: Room = { code: 'TEST', hostId: 'a', players, state: stateName, activeCreatorIndex: 0,
        currentVotes: {}, currentRound: 1, maxRounds: rounds, currentPrompt: 'wave', currentVideoUrl: '/assets/mock-video.mp4', ...initial };
    const sockets = players.map(p => new TestSocket({ socketId: p.connectionId, playerId: p.id, sessionId: p.sessionId }));
    const outsider = new TestSocket({ socketId: 'outsider' }); sockets.push(outsider);
    const data = new Map<string, unknown>([['room', room]]);
    let ready!: Promise<void>;
    const pending: Promise<unknown>[] = [];
    const alarms: number[] = [];
    let alarm: number | null = null;
    const state = {
        storage: {
            get: async (key: string) => structuredClone(data.get(key)),
            put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
            delete: async (key: string) => data.delete(key),
            getAlarm: async () => alarm,
            setAlarm: async (time: number) => { alarm = time; alarms.push(time); }
        },
        getWebSockets: () => sockets,
        acceptWebSocket: () => {},
        blockConcurrencyWhile: (callback: () => Promise<void>) => ready = callback(),
        waitUntil: (promise: Promise<unknown>) => { pending.push(promise); }
    };
    const worker = new RoomDurableObject(state as any, { AI_PROVIDER: 'mock', AUTH_MODE: 'disabled', ...overrides } as any);
    await ready;
    const message = (socket: TestSocket, type: string, payload: unknown = {}) => worker.webSocketMessage(socket as any, JSON.stringify({ type, payload }));
    const recreate = async () => {
        const restored = new RoomDurableObject(state as any, { AI_PROVIDER: 'mock', AUTH_MODE: 'disabled', ...overrides } as any);
        await ready;
        return restored;
    };
    return { worker, sockets, outsider, data, pending, message, recreate, alarms };
}

test('Worker serializes votes and ignores duplicates; outsiders cannot vote or read room snapshots', async () => {
    const f = await fixture();
    await f.message(f.outsider, 'submitVote', { points: 5 });
    await Promise.all([f.message(f.sockets[1], 'submitVote', { points: 4 }), f.message(f.sockets[2], 'submitVote', { points: 5 }), f.message(f.sockets[2], 'submitVote', { points: 5 })]);
    const room = f.data.get('room') as Room;
    assert.equal(room.state, 'GAME_OVER');
    assert.equal(room.players[0].score, 9);
    assert.equal(f.outsider.messages.some(m => m.type === 'roomDataUpdate'), false);
    assert.equal(f.outsider.messages[0].type, 'errorMsg');
    assert.equal(JSON.stringify(f.sockets[0].messages).includes('session-'), false);
});

test('Worker applies actual lobby membership to the round limit and reserves all videos', async () => {
    const original = globalThis.fetch;
    let current = 720;
    globalThis.fetch = async () => Response.json({ base: 720, current, resetsAt: null, runs: { remaining: 8 } });
    const budgetData = new Map<string, any>();
    const state = { storage: { get: async (key: string) => structuredClone(budgetData.get(key)), put: async (key: string, value: unknown) => { budgetData.set(key, structuredClone(value)); } } };
    const services = new ServiceDurableObject(state as any, { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'ltx' } as any);
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => services.fetch(request) }) } as any;
    try {
        const f = await fixture('LOBBY', { SERVICES }, 5);
        await f.message(f.sockets[0], 'refreshQuota');
        let r = f.data.get('room') as Room;
        assert.equal(r.quota?.playerCount, 3); assert.equal(r.maxRounds, 2);
        await f.message(f.sockets[1], 'setRoundCount', { rounds: 1 });
        assert.equal((f.data.get('room') as Room).maxRounds, 2, 'Only the host can change rounds.');
        current = 185;
        await f.message(f.sockets[0], 'startGame');
        r = f.data.get('room') as Room;
        assert.equal(r.maxRounds, 0); assert.equal(r.state, 'LOBBY'); assert.equal(budgetData.get('reservations'), undefined);
        current = 720;
        await f.message(f.sockets[0], 'setRoundCount', { rounds: 999 });
        assert.equal((f.data.get('room') as Room).maxRounds, 2);
        await f.message(f.sockets[0], 'startGame');
        r = f.data.get('room') as Room;
        assert.equal(r.state, 'IDLE'); assert.deepEqual(r.pendingCreators, ['a', 'b', 'c']);
        assert.equal(budgetData.get('reservations').TEST.rounds, 6);
        await f.message(f.sockets[1], 'leaveRoom');
        assert.equal(budgetData.get('reservations').TEST.rounds, 4);
        assert.deepEqual((f.data.get('room') as Room).roundPlayers, ['a', 'c']);
    } finally { globalThis.fetch = original; }
});

test('Worker includes cheap fallbacks and restores a two-player round when the third player leaves', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 300, current: 185, resetsAt: null, runs: { remaining: 7 } });
    const data = new Map<string, any>();
    const state = { storage: { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } } };
    const services = new ServiceDurableObject(state as any, { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' } as any);
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => services.fetch(request) }) } as any;
    try {
        const f = await fixture('LOBBY', { SERVICES }, 2);
        await f.message(f.sockets[0], 'startGame');
        assert.equal((f.data.get('room') as Room).state, 'LOBBY');
        await f.message(f.sockets[2], 'leaveRoom');
        const r = f.data.get('room') as Room;
        assert.equal(r.quota?.playerCount, 2); assert.equal(r.quota?.aiRoundLimit, 1);
        assert.equal(r.quota?.gpuSecondsPerRound, 184);
        await f.message(f.sockets[0], 'startGame');
        assert.equal((f.data.get('room') as Room).state, 'IDLE');
        assert.equal(data.get('reservations').TEST.rounds, 2);
        assert.equal(data.get('reservations').TEST.gpuSecondsPerVideo, 92);
    } finally { globalThis.fetch = original; }
});

test('Worker resume retains the player ID, scores and votes while replacing the old connection', async () => {
    const f = await fixture();
    await f.message(f.sockets[1], 'submitVote', { points: 4 });
    await f.message(f.outsider, 'resumeRoom', { sessionId: 'session-b-1234567890' });
    const room = f.data.get('room') as Room;
    assert.equal(room.players[1].id, 'b');
    assert.equal(room.players[1].connectionId, 'outsider');
    assert.equal(room.currentVotes.b, 4);
    assert.equal(f.sockets[1].closed, true);
});

test('Worker discards a generation completed after its creator leaves', async () => {
    const f = await fixture('IDLE');
    const imageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7VQAAAAASUVORK5CYII=';
    await f.message(f.sockets[0], 'sendImage', { imageBase64, prompt: 'wave' });
    await f.message(f.sockets[0], 'leaveRoom');
    await Promise.all(f.pending);
    const room = f.data.get('room') as Room;
    assert.equal(room.state, 'IDLE');
    assert.equal(room.players[room.activeCreatorIndex].id, 'b');
    assert.equal(room.currentVideoUrl, '');
});

function fakeJob(overrides: Partial<AiJob> = {}): AiJob {
    return { provider: 'wan22-fast', root: 'https://test.hf.space', endpoint: '/generate_video', eventId: 'saved-event',
        status: 'running', submittedAt: Date.now(), seed: 123, steps: 4, durationSeconds: 5, ...overrides };
}

test('Worker recreation does not overwrite an existing wake-up alarm', async () => {
    const deadline = Date.now() + 10_000;
    const f = await fixture('VOTING', {}, 1, { soloFinishAt: deadline });
    assert.deepEqual(f.alarms, [deadline]);
    await f.recreate();
    await f.message(f.sockets[0], 'refreshQuota');
    assert.deepEqual(f.alarms, [deadline]);
});

test('Worker restart resumes a persisted job once without another upload or quota reservation', async () => {
    const original = globalThis.fetch;
    let results = 0;
    const servicePaths: string[] = [];
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
        servicePaths.push(new URL(request.url).pathname);
        if (request.url.endsWith('/archive')) return Response.json({ url: '/api/videos/videos/1234567890123-test.mp4' });
        return Response.json({});
    } }) } as any;
    globalThis.fetch = async (input, init) => {
        assert.equal(String(input), 'https://test.hf.space/gradio_api/call/generate_video/saved-event');
        assert.notEqual(init?.method, 'POST'); results++;
        return new Response('event: complete\ndata: ["https://test.hf.space/video.mp4"]\n\n');
    };
    try {
        const f = await fixture('GENERATING', { SERVICES }, 1, { generationId: 'generation-1', generationJob: fakeJob(), currentVideoUrl: '' });
        assert.equal((f.data.get('room') as Room).state, 'GENERATING');
        const restored = await f.recreate();
        await new Promise(resolve => setTimeout(resolve, 110));
        await Promise.all([restored.alarm(), restored.alarm()]);
        await Promise.all(f.pending);
        const room = f.data.get('room') as Room;
        assert.equal(room.state, 'VOTING'); assert.equal(room.generationId, 'generation-1');
        assert.match(room.currentVideoUrl, /^\/api\/videos\//);
        assert.equal(results, 1); assert.equal(servicePaths.filter(path => path === '/quota/consume').length, 1);
        assert.equal(servicePaths.includes('/quota/begin'), false); assert.equal(servicePaths.includes('/quota/attempt'), false);
        assert.equal(JSON.stringify(f.sockets[0].messages).includes('saved-event'), false);
    } finally { globalThis.fetch = original; }
});

test('Worker holds quota for uncertain jobs and persists retries instead of resetting the creator', async () => {
    const original = globalThis.fetch;
    const paths: string[] = [];
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => { paths.push(new URL(request.url).pathname); return Response.json({}); } }) } as any;
    try {
        const f = await fixture('GENERATING', { SERVICES }, 1, { generationId: 'generation-1', generationJob: fakeJob() });
        await new Promise(resolve => setTimeout(resolve, 110)); await f.worker.alarm(); await Promise.all(f.pending);
        let room = f.data.get('room') as Room;
        assert.equal(room.state, 'GENERATING'); assert.equal(room.generationJob?.eventId, 'saved-event'); assert.ok(room.generationRetryAt! > Date.now());
        assert.equal(paths.includes('/quota/consume'), false);
        room.generationJob!.submittedAt = Date.now() - AI_JOB_MAX_AGE_MS;
        f.data.set('room', room);
        const restored = await f.recreate();
        await new Promise(resolve => setTimeout(resolve, 110)); await restored.alarm(); await Promise.all(f.pending);
        room = f.data.get('room') as Room;
        assert.equal(room.state, 'IDLE'); assert.equal(room.generationJob, undefined);
        assert.equal(paths.includes('/quota/consume'), false, 'Unknown remote jobs retain their reservation until TTL.');
    } finally { globalThis.fetch = original; }
});

test('Worker retries a completed quota release after a service outage and recreation', async () => {
    let unavailable = true, calls = 0;
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: async () => {
        calls++; return unavailable ? Response.json({ error: 'Service down' }, { status: 503 }) : Response.json({});
    } }) } as any;
    const f = await fixture('GENERATING', { SERVICES }, 1, { generationId: 'generation-1', generationJob: fakeJob({ status: 'complete', videoUrl: '/assets/mock-video.mp4' }) });
    await new Promise(resolve => setTimeout(resolve, 110)); await f.worker.alarm(); await Promise.all(f.pending);
    assert.equal((f.data.get('room') as Room).state, 'VOTING');
    assert.ok((f.data.get('quotaReleases') as unknown[]).length);
    unavailable = false;
    const restored = await f.recreate(); await restored.alarm(); await Promise.all(f.pending);
    assert.deepEqual(f.data.get('quotaReleases'), []); assert.ok(calls > 1);
});

test('Worker restores abandoned job metadata and releases its budget without showing or archiving the result', async () => {
    const original = globalThis.fetch;
    let results = 0;
    const paths: string[] = [];
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => { paths.push(new URL(request.url).pathname); return Response.json({}); } }) } as any;
    globalThis.fetch = async () => { results++; return new Response('event: complete\ndata: ["https://test.hf.space/video.mp4"]\n\n'); };
    try {
        const job = fakeJob();
        const f = await fixture('GENERATING', { SERVICES }, 1, { generationId: 'generation-1', generationJob: job });
        f.data.set('aiJobs', { 'generation-1': { code: 'TEST', job } });
        const restored = await f.recreate();
        await restored.webSocketMessage(f.sockets[0] as any, JSON.stringify({ type: 'leaveRoom' }));
        await restored.alarm(); await Promise.all(f.pending);
        const room = f.data.get('room') as Room;
        assert.equal(room.state, 'IDLE'); assert.equal(room.players[room.activeCreatorIndex].id, 'b');
        assert.equal(room.currentVideoUrl, ''); assert.equal(results, 1);
        assert.equal(paths.includes('/archive'), false); assert.equal(paths.filter(path => path === '/quota/consume').length, 1);
        assert.deepEqual(f.data.get('aiJobs'), {});
    } finally { globalThis.fetch = original; }
});

test('Worker checks real quota for additional rounds, restricts the host and ignores duplicate/stale requests', async () => {
    const original = globalThis.fetch;
    let current = 185;
    globalThis.fetch = async () => Response.json({ base: 300, current, resetsAt: null, runs: { remaining: 7 } });
    const data = new Map<string, any>();
    const services = new ServiceDurableObject({ storage: { get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } } } as any, { HF_TOKEN: 'test' } as any);
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => services.fetch(request) }) } as any;
    try {
        const f = await fixture('VOTING', { SERVICES });
        await f.message(f.sockets[1], 'submitVote', { points: 4 });
        await f.message(f.sockets[2], 'submitVote', { points: 5 });
        assert.equal((f.data.get('room') as Room).extensionQuota?.aiRoundLimit, 0);
        await f.message(f.sockets[0], 'extendGame', { completedVideo: 1 });
        assert.equal((f.data.get('room') as Room).state, 'GAME_OVER');
        current = 300;
        await f.message(f.sockets[1], 'extendGame', { completedVideo: 1 });
        assert.equal((f.data.get('room') as Room).maxRounds, 1);
        await Promise.all([f.message(f.sockets[0], 'extendGame', { completedVideo: 1 }), f.message(f.sockets[0], 'extendGame', { completedVideo: 1 })]);
        const r = f.data.get('room') as Room;
        assert.equal(r.state, 'IDLE'); assert.equal(r.maxRounds, 2); assert.equal(r.currentRound, 2);
        assert.equal(r.players[0].score, 9); assert.deepEqual(r.pendingCreators, ['a', 'b', 'c']);
        assert.equal(data.get('reservations').TEST.rounds, 3);
        await f.message(f.sockets[0], 'extendGame', { completedVideo: 1 });
        assert.equal((f.data.get('room') as Room).maxRounds, 2);
    } finally { globalThis.fetch = original; }
});

test('Worker retries the final write before the continuation marker after a database outage', async () => {
    const original = globalThis.fetch;
    let failing = true;
    const transactions: string[][] = [];
    globalThis.fetch = async (_input, init) => {
        if (failing) return new Response('Test database unavailable', { status: 503 });
        const body = JSON.parse(String(init?.body));
        const result = { fields: [], rows: [], rowCount: 0, command: 'UPDATE' };
        if (body.queries) {
            transactions.push(body.queries.map((query: { query: string }) => query.query));
            return Response.json({ results: body.queries.map(() => result) });
        }
        return Response.json(result);
    };
    try {
        const f = await fixture('VOTING', { DATABASE_URL: 'postgresql://test:test@ep-test.neon.tech/test' });
        await f.message(f.sockets[1], 'submitVote', { points: 4 }); await f.message(f.sockets[2], 'submitVote', { points: 5 });
        await f.message(f.sockets[0], 'extendGame', { completedVideo: 1 });
        const pending = f.data.get('pendingRounds') as any[];
        assert.equal(pending.length, 2); assert.equal(pending[0].state, 'GAME_OVER'); assert.equal(pending[1].writeAction, 'continue');
        failing = false;
        await (await f.recreate()).alarm();
        assert.equal((f.data.get('pendingRounds') as any[]).length, 0);
        assert.equal(transactions.length, 3);
        assert.ok(transactions[0].every(sql => /^(create|alter)/.test(sql)), 'Schema initialization runs once in its own transaction.');
        assert.ok(transactions[1].some(sql => sql.includes("status = 'GAME_OVER'")));
        assert.ok(transactions[2].some(sql => sql.includes("status = 'PLAYING'") && sql.includes('winner_socket_id = null')));
        assert.ok(transactions[2].some(sql => sql.includes('final_rank = null')));
        assert.equal((f.data.get('room') as Room).players[0].score, 9);
    } finally { globalThis.fetch = original; }
});
