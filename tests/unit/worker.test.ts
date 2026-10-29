import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomDurableObject, ServiceDurableObject, Env } from '../../src/server/cloudflare/worker';
import { AI_JOB_MAX_AGE_MS, type AiJob } from '../../src/ai/generation';
import { Room, roomSnapshot, DISCONNECT_GRACE_MS } from '../../src/game/rules';
import { getDatabase } from '../../src/database/neon';
import { DATABASE_SCHEMA } from '../../src/database/schema';
import { testImageData } from '../support/images';
import { gameOptions } from '../../src/game/options';
import { testHfPlayers, heldHfVideos } from '../support/hf-fixture';
import { normalizeImage } from '../../src/security/images';
import { testModerationConfig } from '../support/moderation-fixture';
import { PendingInputs } from '../../src/security/pending-input';

class TestSocket {
    get readyState() { return this.closed ? 3 : 1; }
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
        currentVotes: {}, ballotId: crypto.randomUUID(), currentRound: 1, maxRounds: rounds, currentPrompt: 'wave', currentVideoUrl: '/assets/mock-video.mp4', ...initial };
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
    const message = (socket: TestSocket, type: string, payload: Record<string, unknown> = {}) => {
        const r = data.get('room') as Room;
        return worker.webSocketMessage(socket as any, JSON.stringify({ type, payload: ['submitVote', 'finishPreview'].includes(type)
            ? { ballotId: r.ballotId, currentRound: r.currentRound, videoNumber: r.videoNumber || r.currentRound, ...payload } : payload }));
    };
    const recreate = async () => {
        const restored = new RoomDurableObject(state as any, { AI_PROVIDER: 'mock', AUTH_MODE: 'disabled', ...overrides } as any);
        await ready;
        return restored;
    };
    return { worker, sockets, outsider, data, pending, message, recreate, alarms, storage: state.storage };
}

test('Worker preserves a mobile participant for 90 seconds, resumes safely and expires the new disconnect at its boundary', async () => {
    const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
    try {
        const f = await fixture('LOBBY');
        await f.message(f.sockets[1], 'setReady', { ready: true });
        await f.worker.webSocketClose(f.sockets[1] as never);
        now += 20_000; await f.worker.alarm();
        let room = f.data.get('room') as Room;
        assert.equal(room.players.length, 3); assert.equal(room.players[1].connected, false);
        assert.equal(room.players[1].ready, false);
        await f.message(f.outsider, 'resumeRoom', { sessionId: 'session-b-1234567890' });
        room = f.data.get('room') as Room;
        assert.equal(room.players[1].connectionId, 'outsider'); assert.equal(room.players[1].connected, true);
        assert.equal(room.players[1].ready, false);
        await f.worker.webSocketClose(f.outsider as never);
        now += DISCONNECT_GRACE_MS - 1; await f.worker.alarm();
        assert.equal((f.data.get('room') as Room).players.length, 3);
        now++; await f.worker.alarm();
        assert.equal((f.data.get('room') as Room).players.length, 2);
        assert.equal((f.data.get('room') as Room).players.some(player => player.id === 'b'), false);
    } finally { Date.now = originalNow; }
});

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

test('Worker enforces ready on the server, resets it on options and disconnect, and excludes spectators', async () => {
    const f = await fixture('LOBBY', {}, 1, { options: gameOptions({ requireReady: true }) });
    await f.message(f.outsider, 'joinRoom', { username: 'Viewer', role: 'spectator' });
    await f.message(f.sockets[0], 'startGame'); assert.equal((f.data.get('room') as Room).state, 'LOBBY');
    for (const socket of f.sockets.slice(0, 3)) await f.message(socket, 'setReady', { ready: true });
    await f.message(f.sockets[0], 'setGameOptions', { options: { requireReady: true } });
    assert.equal((f.data.get('room') as Room).players.some(p => p.ready), false);
    for (const socket of f.sockets.slice(0, 3)) await f.message(socket, 'setReady', { ready: true });
    await f.message(f.sockets[0], 'startGame'); assert.equal((f.data.get('room') as Room).state, 'IDLE');
    for (const type of ['sendImage', 'submitVote', 'judgeGuesses', 'setReady', 'setGameOptions', 'startNextRound', 'rematchGame']) {
        await f.message(f.outsider, type, { points: 5, ready: true }); assert.match(f.outsider.messages.at(-1)!.payload, /Zuschauer/);
    }
    const before = (f.data.get('room') as Room).players.map(p => p.score);
    assert.deepEqual(before, [0, 0, 0]);
    const restored = await f.recreate();
    await restored.webSocketClose(f.sockets[1] as any);
    assert.equal((f.data.get('room') as Room).players[1].ready, false);
    assert.equal((f.data.get('room') as Room).spectators!.length, 1);
});

test('Worker rematch is durable/idempotent, transfers only own sessions and initializes a new room once', async () => {
    const target = await fixture('LOBBY'); target.data.delete('room'); target.sockets.length = 0;
    const targetWorker = await target.recreate(); let calls = 0;
    const f = await fixture('GAME_OVER', { ROOMS: { idFromName: name => name, get: () => ({ fetch: async request => { calls++; return targetWorker.fetch(request); } }) } as any });
    await f.message(f.outsider, 'joinRoom', { username: 'Viewer', role: 'spectator' });
    await f.message(f.sockets[1], 'rematchGame'); assert.equal(calls, 0);
    await f.message(f.sockets[0], 'rematchGame');
    const old = f.data.get('room') as Room, next = target.data.get('room') as Room;
    assert.equal(old.state, 'GAME_OVER'); assert.equal(old.currentVideoUrl, '/assets/mock-video.mp4');
    assert.equal(next.players.length, 3); assert.equal(next.spectators!.length, 1); assert.equal(next.currentVideoUrl, '');
    assert.equal(next.players.every(p => !p.ready && p.score === 0), true);
    for (const socket of f.sockets) {
        const transfer = socket.messages.find(m => m.type === 'roomTransfer')!.payload;
        assert.equal(Object.keys(transfer).sort().join(','), 'playerId,roomId,sessionId');
        assert.notEqual(transfer.sessionId, socket.attachment.sessionId);
        assert.equal(next.players.concat(next.spectators!).some(p => p.sessionId === transfer.sessionId), true);
    }
    const code = next.code;
    await f.message(f.sockets[0], 'rematchGame'); assert.equal((target.data.get('room') as Room).code, code); assert.equal(calls, 1);
    const restored = await f.recreate();
    await restored.webSocketMessage(f.sockets[0] as any, JSON.stringify({ type: 'resumeRoom', payload: { sessionId: old.players[0].sessionId } }));
    assert.equal(f.sockets[0].messages.at(-1)!.type, 'roomTransfer');
});

test('Worker rechecks socket connectivity after an asynchronous budget reservation', async () => {
    let f: Awaited<ReturnType<typeof fixture>>, releases = 0;
    const services = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
        if (request.url.endsWith('/quota/reserve')) { await Promise.resolve(); f.sockets[1].closed = true; }
        if (request.url.endsWith('/quota/release')) releases++;
        return Response.json({ aiRoundLimit: 5, quotaMode: 'mock' });
    } }) };
    f = await fixture('LOBBY', { SERVICES: services as any });
    await f.message(f.sockets[0], 'startGame');
    assert.equal((f.data.get('room') as Room).state, 'LOBBY'); assert.equal(releases, 1);
    assert.match(f.sockets[0].messages.at(-1)!.payload, /verbunden/);
});

test('Worker withholds new private snapshots from a revoked idle WebSocket session', async () => {
    let rotated = false;
    const services = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
        if (request.url.endsWith('/profiles/find')) {
            const data = await request.json() as any;
            return Response.json({ profile: { id: data.name, name: data.name, authVersion: rotated && data.name === 'a' ? 'new-version' : '0' } });
        }
        return Response.json({ aiRoundLimit: 5, quotaMode: 'mock' });
    } }) };
    const f = await fixture('IDLE', { AUTH_MODE: '', SERVICES: services as any });
    for (const socket of f.sockets.slice(0, 3)) socket.attachment.account = { id: socket.attachment.playerId, name: socket.attachment.playerId, expiresAt: Date.now() + 60_000, authVersion: '0', identityProof: 'owner' };
    (f.worker as any).broadcastRoomUpdate(); await Promise.all(f.pending);
    const previous = f.sockets[0].messages.filter(m => m.type === 'roomDataUpdate').length;
    assert.equal(previous, 1); rotated = true;
    (f.worker as any).broadcastRoomUpdate(); await Promise.all(f.pending);
    assert.equal(f.sockets[0].messages.filter(m => m.type === 'roomDataUpdate').length, previous);
    assert.equal(f.sockets[0].messages.some(m => m.type === 'authExpired'), true); assert.equal(f.sockets[0].closed, true);
});

test('Worker retries the same initialized rematch after an ambiguous target response', async () => {
    const target = await fixture('LOBBY'); target.data.delete('room'); target.sockets.length = 0;
    const worker = await target.recreate(); const codes: string[] = [];
    const f = await fixture('GAME_OVER', { ROOMS: { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (request: Request) => {
        codes.push(name); const response = await worker.fetch(request);
        if (codes.length === 1) throw new Error('Response lost after initialization'); return response;
    } }) } as any });
    await f.message(f.sockets[0], 'rematchGame');
    assert.equal(f.sockets[0].messages.some(m => m.type === 'roomTransfer'), false);
    assert.equal((f.data.get('room') as Room).rematch!.initialized, false);
    const restored = await f.recreate();
    await restored.webSocketMessage(f.sockets[0] as any, JSON.stringify({ type: 'rematchGame' }));
    assert.equal(codes.length, 2); assert.equal(codes[0], codes[1]);
    assert.equal((f.data.get('room') as Room).rematch!.initialized, true);
    assert.equal((target.data.get('room') as Room).code, codes[0]);
});

test('Worker phase clock survives recreation, enforces host-only closing and ignores stale commands', async () => {
    const f = await fixture('LOBBY', {}, 1, { options: gameOptions({ phaseSeconds: 60 }) });
    await f.message(f.sockets[0], 'startGame');
    let r = f.data.get('room') as Room; const key = r.phaseKey, deadline = r.phaseDeadline;
    assert.ok(deadline); assert.ok(f.alarms.includes(deadline!));
    await f.message(f.sockets[1], 'closePhase', { phaseKey: key }); assert.equal((f.data.get('room') as Room).state, 'IDLE');
    await f.message(f.sockets[0], 'closePhase', { phaseKey: key }); assert.equal((f.data.get('room') as Room).state, 'RESULTS');
    await f.message(f.sockets[0], 'startNextRound'); r = f.data.get('room') as Room;
    assert.equal(r.activeCreatorIndex, 1);
    await f.message(f.sockets[0], 'closePhase', { phaseKey: key }); assert.equal((f.data.get('room') as Room).state, 'IDLE');
    r.phaseDeadline = Date.now() - 1; f.data.set('room', r);
    const restored = await f.recreate(); await restored.alarm(); r = f.data.get('room') as Room;
    assert.equal(r.state, 'RESULTS'); assert.equal(r.players.every(player => player.score === 0), true);
});

test('Worker archive games bypass HF, persist replay state and never rewrite creation statistics', async () => {
    const url = 'postgres://test:test@ep-archive-test.neon.tech/neondb';
    const database = getDatabase(url)!;
    const original = database.playableArchive;
    database.playableArchive = async () => ['1', '2', '3'].map(id => ({ id, creatorId: 'old', creatorName: 'Original', prompt: `secret ${id}`, videoUrl: `/api/videos/videos/${id}.mp4` }));
    try {
        const f = await fixture('LOBBY', { DATABASE_URL: url }, 1, { options: gameOptions({ mode: 'archive-vote' }) });
        await f.message(f.sockets[0], 'startGame'); let r = f.data.get('room') as Room;
        assert.equal(r.state, 'VOTING'); assert.equal(r.quota?.quotaMode, 'archive'); assert.equal(r.archiveClips?.length, 2);
        const worker = await f.recreate();
        for (const socket of f.sockets.slice(0, 3)) {
            const r = f.data.get('room') as Room;
            await worker.webSocketMessage(socket as any, JSON.stringify({ type: 'submitVote', payload: { ...roomSnapshot(r), points: 4 } }));
        }
        r = f.data.get('room') as Room; assert.equal(r.state, 'RESULTS'); assert.equal(r.archiveResults?.[0].points, 12);
        assert.equal(r.players.every(player => player.score === 0), true); assert.deepEqual(f.data.get('pendingRounds'), []);
        await worker.webSocketMessage(f.sockets[0] as any, JSON.stringify({ type: 'startNextRound', payload: {} }));
        r = f.data.get('room') as Room; assert.equal(r.state, 'VOTING'); assert.equal(r.archiveClips?.length, 1);
    } finally { database.playableArchive = original; }
});

test('Worker rechecks active archive bans before scores and after hibernation, holding on unavailable status', async () => {
    const videoUrl = '/api/videos/videos/1792000000000-abcd-aabbcc.mp4';
    let denied = true, unavailable = false;
    const services = { idFromName: () => 'global', get: () => ({ fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (path === '/security/content/blocked') return new Response(JSON.stringify(unavailable ? {} : { blocked: denied }), { status: unavailable ? 503 : 200 });
        return new Response(JSON.stringify({ ok: true }));
    } }) } as unknown as Env['SERVICES'];
    const initial: Partial<Room> = { options: gameOptions({ mode: 'archive-vote' }), currentVideoUrl: videoUrl,
        archiveCurrent: { id: 'old', creatorId: 'old', creatorName: 'Original', prompt: 'private old prompt', videoUrl },
        pendingCreators: ['a', 'b', 'c'], roundPlayers: ['a', 'b', 'c'], archiveResults: [], currentVotes: { a: 5, b: 4 } };
    const f = await fixture('VOTING', { SERVICES: services }, 1, initial);
    await f.message(f.sockets[2], 'submitVote', { points: 5 });
    let r = f.data.get('room') as Room;
    assert.equal(r.state, 'RESULTS'); assert.deepEqual(r.archiveResults, []); assert.equal(r.currentVideoUrl, '');
    assert.equal(r.players.every(player => player.score === 0), true); assert.deepEqual(r.currentVotes, {});
    const notices = f.sockets[0].messages.filter(m => m.type === 'roomNotice'); assert.match(notices.at(-1)!.payload, /übersprungen/);
    // A different currently displayed ballot survives a service outage without
    // awarding its otherwise complete votes, even when the host closes it.
    r = { ...r, ...structuredClone(initial), state: 'VOTING', phaseKey: undefined, phaseDeadline: undefined };
    f.data.set('room', r); denied = false; unavailable = true;
    const restored = await f.recreate(); await restored.alarm();
    r = f.data.get('room') as Room; assert.equal(r.state, 'VOTING'); assert.deepEqual(r.archiveResults, []);
    await restored.webSocketMessage(f.sockets[0] as never, JSON.stringify({ type: 'closePhase', payload: { phaseKey: r.phaseKey } }));
    assert.equal((f.data.get('room') as Room).state, 'VOTING');
    unavailable = false; denied = true;
    const restarted = await f.recreate(); await restarted.alarm();
    assert.equal((f.data.get('room') as Room).state, 'RESULTS');
    assert.ok(f.alarms.some(time => time <= Date.now() + 10_100));
});

test('Worker stops scoring a newly banned classic video after hibernation and preserves a failed status check', async () => {
    let denied = false, unavailable = true;
    const paths: string[] = [];
    const services = { idFromName: () => 'global', get: () => ({ fetch: async (request: Request) => {
        const path = new URL(request.url).pathname; paths.push(path);
        if (path === '/security/content/blocked') return Response.json(unavailable ? {} : { blocked: denied }, { status: unavailable ? 503 : 200 });
        return Response.json({ ok: true, aiRoundLimit: 0 });
    } }) } as unknown as Env['SERVICES'];
    const f = await fixture('GUESS_REVIEW', { SERVICES: services }, 1, {
        options: gameOptions({ guessPrompt: true }), currentVideoUrl: '/api/videos/videos/1792000000000-abcd-aabbcc.mp4',
        pendingCreators: ['a'], roundPlayers: ['a', 'b', 'c'], currentVotes: { b: 5, c: 4 },
        guesses: { b: { text: 'wave', correct: true }, c: { text: 'dance', correct: false } }, guessesReviewed: false
    });
    const restored = await f.recreate(); await restored.alarm();
    let r = f.data.get('room') as Room;
    assert.equal(r.state, 'GUESS_REVIEW'); assert.equal(r.players.every(p => p.score === 0), true);
    assert.equal(r.currentVotes.b, 5);
    unavailable = false; denied = true;
    const restarted = await f.recreate(); await restarted.alarm();
    r = f.data.get('room') as Room;
    assert.equal(r.state, 'GAME_OVER'); assert.equal(r.currentVideoUrl, ''); assert.equal(r.currentPrompt, '');
    assert.deepEqual(r.currentVotes, {}); assert.deepEqual(r.guesses, {});
    assert.equal(r.players.every(p => p.score === 0), true); assert.ok(paths.includes('/quota/release'));
    assert.deepEqual(f.data.get('pendingRounds') || [], []);
});

test('Worker restores private tasks, chunked common images and creator-only guess review after recreation', async () => {
    const f = await fixture('LOBBY', {}, 1, { imageProfile: 'bounded', options: gameOptions({ sharedImage: true, secretTasks: true, guessPrompt: true }) });
    await f.message(f.sockets[1], 'setSharedImage', { imageBase64: testImageData(832, 624) });
    assert.equal((f.data.get('room') as Room).sharedImage, undefined);
    const image = testImageData(832, 624, true);
    await f.message(f.sockets[0], 'setSharedImage', { imageBase64: image });
    let room = f.data.get('room') as Room;
    assert.ok(room.sharedImage!.chunks > 1);
    let worker = await f.recreate();
    const path = `https://game.test/api/rooms/TEST/image?id=${room.sharedImage!.id}`;
    const response = await worker.fetch(new Request(path));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from((await normalizeImage(image)).split(',')[1], 'base64'));
    room.state = 'IDLE'; room.sharedImage!.expiresAt = Date.now() - 1;
    f.data.set('room', room); worker = await f.recreate(); await worker.alarm();
    assert.equal((f.data.get('room') as Room).sharedImage, undefined);
    assert.equal([...f.data.keys()].some(key => key.startsWith('image:')), false);
    await worker.webSocketMessage(f.sockets[0] as any, JSON.stringify({ type: 'setSharedImage', payload: { imageBase64: image } }));
    room = f.data.get('room') as Room; assert.ok(room.sharedImage);
    room.state = 'VOTING'; room.tasks = { a: 'Auftrag a', b: 'Auftrag b', c: 'Auftrag c' }; room.currentPrompt = 'private prompt';
    f.data.set('room', room); worker = await f.recreate();
    const send = (index: number, type: string, payload: Record<string, unknown>) => worker.webSocketMessage(f.sockets[index] as any,
        JSON.stringify({ type, payload: type === 'submitVote' ? { ...roomSnapshot(f.data.get('room') as Room), ...payload } : payload }));
    await send(1, 'submitVote', { taskPoints: 5, funPoints: 3, guess: 'spin' });
    await send(2, 'submitVote', { taskPoints: 2, funPoints: 4, guess: 'run' });
    assert.equal((f.data.get('room') as Room).state, 'GUESS_REVIEW');
    worker = await f.recreate();
    await send(1, 'judgeGuesses', { videoNumber: 1, correctPlayerIds: ['b'] });
    assert.equal((f.data.get('room') as Room).state, 'GUESS_REVIEW');
    await send(0, 'judgeGuesses', { videoNumber: 1, correctPlayerIds: ['b'] });
    room = f.data.get('room') as Room;
    assert.equal(room.state, 'GAME_OVER'); assert.equal(room.players[0].score, 7); assert.equal(room.players[1].score, 2);
    await send(0, 'judgeGuesses', { videoNumber: 1, correctPlayerIds: ['b'] });
    assert.equal((f.data.get('room') as Room).players[1].score, 2);
    const review = f.sockets[0].messages.filter(message => message.type === 'roomDataUpdate' && message.payload.gameState === 'GUESS_REVIEW').at(-1)!.payload;
    assert.equal(review.reviewPrompt, 'private prompt'); assert.equal(review.reviewGuesses.length, 2);
    const guest = f.sockets[1].messages.filter(message => message.type === 'roomDataUpdate' && message.payload.gameState === 'GUESS_REVIEW').at(-1)!.payload;
    assert.equal(guest.reviewPrompt, undefined); assert.equal(guest.reviewGuesses, undefined); assert.equal(guest.ownTask, undefined);
    assert.equal(f.outsider.messages.some(message => message.type === 'roomDataUpdate'), false);
    await send(0, 'leaveRoom', {}); await send(1, 'leaveRoom', {}); await send(2, 'leaveRoom', {});
    assert.equal([...f.data.keys()].some(key => key.startsWith('image:')), false);
});

test('Worker revokes deleted profiles on game messages before generation and advances past the removed player', async () => {
    const profile = { id: 'account-a', name: 'a', expiresAt: Date.now() + 60_000 };
    const services = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        return new Response(JSON.stringify(path === '/profiles/find' ? { profile: null } : { aiRoundLimit: 5, quotaMode: 'mock' }), { headers: { 'content-type': 'application/json' } });
    } }) };
    const f = await fixture('IDLE', { AUTH_MODE: '', SERVICES: services } as any);
    f.sockets[0].attachment.account = profile;
    const restored = await f.recreate();
    await restored.webSocketMessage(f.sockets[0] as any, JSON.stringify({ type: 'sendImage', payload: {} }));
    const room = f.data.get('room') as Room;
    assert.equal(room.players.some(player => player.id === 'a'), false);
    assert.equal(room.state, 'IDLE');
    assert.equal(f.sockets[0].closed, true);
    assert.equal(f.sockets[0].messages.some(message => message.type === 'authExpired'), true);
});

test('Worker rejects deleting an active room and closes completed rooms without recreating history', async () => {
    const url = 'postgresql://test:test@ep-delete-history.neon.tech/test';
    const database = getDatabase(url)!;
    let deletes = 0;
    database.historyVideos = async () => [];
    database.roomExists = async () => true;
    database.deleteRoom = async () => { deletes++; };
    const request = () => new Request('https://internal/statistics/delete', { method: 'POST', body: JSON.stringify({ code: 'TEST' }) });
    const active = await fixture('VOTING', { DATABASE_URL: url });
    assert.equal((await active.worker.fetch(request())).status, 409);
    assert.equal(deletes, 0);
    const ended = await fixture('GAME_OVER', { DATABASE_URL: url });
    assert.equal((await ended.worker.fetch(request())).status, 200);
    assert.equal(deletes, 1);
    assert.equal(ended.data.has('room'), false);
    assert.ok(ended.sockets.every(socket => socket.closed));
    await (await ended.recreate()).alarm();
    assert.equal(ended.data.has('room'), false);
    assert.deepEqual(ended.data.get('pendingRounds') || [], []);
});

test('retained video IDs can be deleted or restored without affecting a new active game with the same room code', async () => {
    const url = 'postgresql://test:test@ep-independent-video.neon.tech/test';
    const database = getDatabase(url)!;
    let detached = true, deleted = 0, restored = 0, scheduled = 0;
    database.savedVideo = async () => ({ id: '42', roomCode: 'TEST', roundNumber: 1, roomDeleted: detached } as any);
    database.trashVideo = async () => { deleted++; return { undoUntil: Date.now() + 30_000 }; };
    database.restoreVideo = async () => { restored++; return true; };
    let alarm: number | null = null;
    const globalService = new ServiceDurableObject({ storage: { getAlarm: async () => alarm,
        setAlarm: async (time: number) => { alarm = time; scheduled++; } } } as any, { DATABASE_URL: url, AI_PROVIDER: 'mock' } as any);
    const services = { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => globalService.fetch(request) }) };
    const f = await fixture('VOTING', { DATABASE_URL: url, SERVICES: services } as any);
    const command = (restore = false) => new Request('https://internal/statistics/delete', { method: 'POST', body: JSON.stringify({ code: 'TEST', roundNumber: 1, videoId: '42', restore }) });
    assert.equal((await f.worker.fetch(command())).status, 200);
    assert.equal(deleted, 1); assert.equal(scheduled, 1);
    assert.equal((f.data.get('room') as Room).currentVideoUrl, '/assets/mock-video.mp4');
    assert.equal((f.data.get('room') as Room).state, 'VOTING');
    detached = false;
    assert.equal((await f.worker.fetch(command())).status, 409, 'A video belonging to the active game remains protected.');
    assert.equal(deleted, 1);
    assert.equal((await f.worker.fetch(command(true))).status, 200);
    assert.equal(restored, 1);
    assert.equal((f.data.get('room') as Room).currentVideoUrl, '/assets/mock-video.mp4');
    detached = true; database.trashVideo = async () => undefined;
    assert.equal((await f.worker.fetch(command())).status, 410, 'Expired undo errors retain their HTTP status across the global service.');
});

test('global video-cleanup alarms survive service recreation and retry failed storage deletions', async () => {
    const url = 'postgresql://test:test@ep-video-cleanup.neon.tech/test';
    const database = getDatabase(url)!;
    let finalized = 0, alarm: number | null = null;
    database.expiredVideos = async () => finalized ? [] : [{ id: '42', videoUrl: '/api/videos/videos/1234567890123-cleanup.mp4' }];
    database.finalizeVideoDeletion = async () => { finalized++; };
    database.nextVideoDeletion = async () => undefined;
    const data = new Map<string, unknown>();
    const state = { storage: { get: async (key: string) => data.get(key), put: async (key: string, value: unknown) => { data.set(key, value); },
        getAlarm: async () => alarm, setAlarm: async (time: number) => { alarm = time; } } };
    const env = { DATABASE_URL: url, AI_PROVIDER: 'mock', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_ENDPOINT_URL_S3: 'https://cleanup.test' };
    const service = new ServiceDurableObject(state as any, env as any);
    const deadline = Date.now() + 30_000;
    const schedule = (time: number) => service.fetch(new Request('https://internal/video-trash/schedule', { method: 'POST', body: JSON.stringify({ time }) }));
    assert.equal((await schedule(deadline)).status, 200);
    await schedule(deadline + 10_000); assert.equal(alarm, deadline);
    const original = globalThis.fetch;
    try {
        let fail = true;
        globalThis.fetch = async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            assert.equal(request.method, 'DELETE');
            assert.match(request.url, /1234567890123-cleanup.mp4/);
            return new Response(null, { status: fail ? 403 : 204 });
        };
        const recreated = new ServiceDurableObject(state as any, env as any);
        alarm = null; await recreated.alarm();
        assert.equal(finalized, 0); assert.ok(alarm! > Date.now() + 29_000);
        fail = false; alarm = null; await recreated.alarm();
        assert.equal(finalized, 1);
    } finally { globalThis.fetch = original; }
});

test('Worker reserves all videos against distinct personal accounts and releases only the leaving player', async () => {
    const original = globalThis.fetch;
    let current = 720;
    globalThis.fetch = async () => Response.json({ base: 720, current, resetsAt: null, runs: { remaining: 8 } });
    const budgetData = new Map<string, any>();
    const personal = await testHfPlayers(budgetData, ['a', 'b', 'c'], true);
    const state = { storage: personal.storage };
    const services = new ServiceDurableObject(state as any, { ...personal.config, HF_TOKEN: 'must-never-be-used', AI_PROVIDER_CHAIN: 'ltx' } as any);
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => services.fetch(request) }) } as any;
    try {
        const f = await fixture('LOBBY', { SERVICES }, 5, { players: personal.players });
        await f.message(f.sockets[0], 'refreshQuota');
        let r = f.data.get('room') as Room;
        assert.equal(r.quota?.playerCount, 3); assert.equal(r.maxRounds, 5);
        await f.message(f.sockets[1], 'setRoundCount', { rounds: 1 });
        assert.equal((f.data.get('room') as Room).maxRounds, 5, 'Only the host can change rounds.');
        await f.message(f.sockets[0], 'setRoundCount', { rounds: 999 });
        assert.equal((f.data.get('room') as Room).maxRounds, 6);
        await f.message(f.sockets[0], 'startGame');
        r = f.data.get('room') as Room;
        assert.equal(r.state, 'IDLE'); assert.deepEqual(r.pendingCreators, ['a', 'b', 'c']);
        assert.equal(heldHfVideos(budgetData), 18);
        await f.message(f.sockets[1], 'leaveRoom');
        assert.equal(heldHfVideos(budgetData), 12);
        assert.deepEqual((f.data.get('room') as Room).roundPlayers, ['a', 'c']);
    } finally { globalThis.fetch = original; }
});

test('Worker refuses legacy duplicate-HF voting rosters before reserving GPU quota', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 300, current: 185, resetsAt: null, runs: { remaining: 7 } });
    const data = new Map<string, any>();
    const personal = await testHfPlayers(data, ['a', 'b', 'c']);
    const state = { storage: personal.storage };
    const services = new ServiceDurableObject(state as any, { ...personal.config, HF_TOKEN: 'must-never-be-used', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' } as any);
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => services.fetch(request) }) } as any;
    try {
        const f = await fixture('LOBBY', { SERVICES }, 2, { players: personal.players });
        await f.message(f.sockets[0], 'startGame');
        assert.equal((f.data.get('room') as Room).state, 'LOBBY');
        assert.match(f.sockets[0].messages.at(-1)?.payload, /nur einen Spieler/);
        assert.equal(heldHfVideos(data), 0);
        await f.message(f.sockets[2], 'leaveRoom');
        const r = f.data.get('room') as Room;
        assert.equal(r.quota?.playerCount, 2); assert.equal(r.quota?.aiRoundLimit, 1);
        assert.equal(r.quota?.sharedQuota, false);
        await f.message(f.sockets[0], 'startGame');
        assert.equal((f.data.get('room') as Room).state, 'LOBBY');
        assert.equal(heldHfVideos(data), 0);
        assert.match(f.sockets[0].messages.at(-1)?.payload, /nur einen Spieler/);
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
    const imageBase64 = testImageData(1, 1);
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
    const f = await fixture('GENERATING', {}, 1, { generationId: 'generation-1', generationJob: fakeJob() });
    const deadline = f.alarms[0];
    assert.deepEqual(f.alarms, [deadline]);
    await f.recreate();
    await f.message(f.sockets[0], 'refreshQuota');
    assert.deepEqual(f.alarms, [deadline]);
});

test('Worker solo preview survives alarms and recreation until its player confirms the current video', async () => {
    const player = { id: 'a', name: 'a', sessionId: 'session-a-1234567890', connectionId: 'conn-a', connected: true, score: 0 };
    const f = await fixture('VOTING', {}, 1, { players: [player], videoNumber: 1, pendingCreators: ['a'] });
    await f.worker.alarm();
    const restored = await f.recreate();
    await restored.alarm();
    assert.equal((f.data.get('room') as Room).state, 'VOTING');
    await f.message(f.outsider, 'finishPreview', { videoNumber: 1 });
    await f.message(f.sockets[0], 'finishPreview', { videoNumber: 2 });
    assert.equal((f.data.get('room') as Room).state, 'VOTING');
    await f.message(f.sockets[0], 'finishPreview', { videoNumber: 1 });
    await f.message(f.sockets[0], 'finishPreview', { videoNumber: 1 });
    assert.equal((f.data.get('room') as Room).state, 'GAME_OVER');
    assert.equal((f.data.get('room') as Room).players[0].score, 0);
});

test('Worker retains completed output after archive failure and recovers without a token or another GPU job', async () => {
    let offline = true; const paths: string[] = [];
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
        paths.push(new URL(request.url).pathname);
        return request.url.endsWith('/archive') ? offline ? Response.json({ error: 'Videoarchiv nicht erreichbar.' }, { status: 503 })
            : Response.json({ url: '/api/videos/videos/1234567890123-test.mp4' }) : Response.json({});
    } }) } as any;
    const f = await fixture('GENERATING', { SERVICES }, 1, { generationId: 'generation-1',
        generationJob: fakeJob({ status: 'complete', videoUrl: 'https://test.hf.space/video.mp4' }), currentVideoUrl: '' });
    await new Promise(resolve => setTimeout(resolve, 110));
    await f.worker.alarm(); await Promise.all(f.pending);
    const room = f.data.get('room') as Room;
    assert.equal(room.state, 'GENERATING'); assert.equal(room.currentVideoUrl, '');
    assert.equal(room.generationJob?.status, 'complete'); assert.ok(room.generationRetryAt! > Date.now());
    assert.equal(f.sockets[0].messages.some(message => message.type === 'roomDataUpdate' && message.payload.gameState === 'VOTING'), false);
    offline = false;
    const restored = await f.recreate(); await new Promise(resolve => setTimeout(resolve, 110));
    await restored.alarm(); await Promise.all(f.pending);
    assert.equal((f.data.get('room') as Room).state, 'VOTING');
    assert.equal(paths.filter(p => p === '/archive').length, 2);
    assert.equal(paths.includes('/quota/token'), false); assert.equal(paths.includes('/quota/attempt'), false);
});

test('Worker recovers a lost publication checkpoint from completed output without new inference or token use', async () => {
    const paths: string[] = [], artifacts: unknown[] = [];
    const SERVICES = { idFromName: () => 'global', get: () => ({ fetch: async (request: Request) => {
        const path = new URL(request.url).pathname; paths.push(path);
        if (path === '/archive') {
            artifacts.push((await request.json() as { artifact: unknown }).artifact);
            return Response.json({ url: '/api/videos/videos/1792000000000-checkpoint.mp4' });
        }
        return Response.json({});
    } }) } as unknown as Env['SERVICES'];
    const f = await fixture('GENERATING', { SERVICES }, 1, { generationId: 'publication-job',
        generationJob: fakeJob({ status: 'complete', videoUrl: 'https://test.hf.space/finished.mp4' }), currentVideoUrl: '' });
    const originalPut = f.storage.put;
    let failPublication = true;
    f.storage.put = async (key, value) => {
        if (key === 'room' && (value as Room).state === 'VOTING' && failPublication) {
            failPublication = false; throw new Error('simulated publication checkpoint outage');
        }
        await originalPut(key, value);
    };
    await new Promise(resolve => setTimeout(resolve, 110)); await f.worker.alarm(); await Promise.all(f.pending);
    assert.equal((f.data.get('room') as Room).state, 'GENERATING');
    assert.equal((f.data.get('room') as Room).generationJob?.status, 'complete');
    const restored = await f.recreate(); await new Promise(resolve => setTimeout(resolve, 110));
    await Promise.all([restored.alarm(), restored.alarm()]); await Promise.all(f.pending);
    assert.equal((f.data.get('room') as Room).state, 'VOTING');
    assert.equal(artifacts.length, 2); assert.deepEqual(artifacts[0], artifacts[1], 'Archive retry retains the same deterministic artifact identity.');
    assert.equal(paths.some(path => ['/quota/token', '/quota/attempt', '/quota/begin'].includes(path)), false);
    assert.equal((f.data.get('room') as Room).currentVideoUrl, '/api/videos/videos/1792000000000-checkpoint.mp4');
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
        const before = roomSnapshot(f.data.get('room') as Room, 'a').generation;
        assert.equal(before?.id, 'generation-1'); assert.ok(before!.startedAt > 0);
        assert.equal((f.data.get('room') as Room).state, 'GENERATING');
        const restored = await f.recreate();
        assert.deepEqual(roomSnapshot(f.data.get('room') as Room, 'a').generation, before, 'A reconstructed DO preserves the known job and elapsed time.');
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
    const personal = await testHfPlayers(data, ['a', 'b', 'c']);
    const services = new ServiceDurableObject({ storage: personal.storage } as any, { ...personal.config, HF_TOKEN: 'must-never-be-used' } as any);
    const SERVICES = { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => services.fetch(request) }) } as any;
    try {
        const f = await fixture('VOTING', { SERVICES }, 1, { players: personal.players });
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
        assert.equal(heldHfVideos(data), 3);
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
        assert.deepEqual(transactions[0], [...DATABASE_SCHEMA], 'Schema initialization and backfill run once in their own transaction.');
        assert.ok(transactions[1].some(sql => sql.includes("status = 'GAME_OVER'")));
        assert.ok(transactions[2].some(sql => sql.includes("status = 'PLAYING'") && sql.includes('winner_socket_id = null')));
        assert.ok(transactions[2].some(sql => sql.includes('final_rank = null')));
        assert.equal((f.data.get('room') as Room).players[0].score, 9);
    } finally { globalThis.fetch = original; }
});

test('private input moderation survives Room recreation, starts budget only after approval and never exposes private media/tickets', async () => {
    const original = globalThis.fetch; let approved = false, posts = 0, gets = 0;
    const calls: string[] = [], ticket = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const services = { idFromName: () => ({}), get: () => ({ fetch: async (request: Request) => {
        const path = new URL(request.url).pathname; calls.push(path);
        const data = await request.json() as { name?: string };
        return Response.json(path === '/profiles/find' ? { profile: { id: `account-${data.name}`, name: data.name } } : { ok: true });
    } }) };
    globalThis.fetch = async (input, options) => {
        assert.ok(String(input).startsWith('https://moderation.test/'), 'No HF/GPU calls in this fixture');
        const digest = new Headers(options?.headers).get('x-content-sha256');
        if (options?.method === 'POST') { posts++; return Response.json({ id: ticket, digest, status: 'pending' }, { status: 202 }); }
        gets++; return approved ? Response.json({ decision: 'allow', digest, decodeComplete: true,
            policyVersion: testModerationConfig.MODERATION_POLICY_VERSION, modelVersion: testModerationConfig.MODERATION_MODEL_VERSION })
            : Response.json({ digest, status: 'pending' }, { status: 202 });
    };
    try {
        const f = await fixture('IDLE', { ...testModerationConfig, MODERATION_URL: 'https://moderation.test/jobs/validate', AI_PROVIDER: 'wan22', AUTH_MODE: '',
            AUTH_COOKIE_SECRET: 'fixture-owner-proof-at-least-32-characters', SERVICES: services as never,
            WAN_SPACE_ID: 'fixture/producer', WAN_SPACE_REVISION: 'a'.repeat(40), WAN_MODEL_ID: 'fixture/model', WAN_MODEL_REVISION: 'b'.repeat(40),
            AWS_ACCESS_KEY_ID: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture', AWS_ENDPOINT_URL_S3: 'https://storage.test' });
        const worker = f.worker as any, room = worker.room as Room;
        room.players.forEach(p => { p.accountId = `account-${p.id}`; });
        f.sockets.slice(0, 3).forEach(s => { s.attachment.account = { id: `account-${s.attachment.playerId}`, name: s.attachment.playerId, identityProof: 'owner', expiresAt: Date.now() + 60_000 }; });
        let generations = 0; worker.runGeneration = () => { generations++; };
        await worker.sendImage(room.players[0], { imageBase64: testImageData(832, 624), prompt: 'Private harmless animation' });
        await Promise.all(f.pending);
        assert.equal(posts, 1); assert.equal(generations, 0); assert.ok(!calls.includes('/quota/begin'));
        const snapshot = JSON.stringify(roomSnapshot(room, 'b'));
        assert.ok(!snapshot.includes('Private harmless animation')); assert.ok(!snapshot.includes('data:image')); assert.ok(!snapshot.includes(ticket));
        assert.equal((f.data.get('room') as Room).generationStage, 'moderation');
        const restored = await f.recreate() as any;
        restored.runGeneration = () => { generations++; };
        restored.input.retryAt = 0; await restored.alarm(); await Promise.all(f.pending);
        assert.equal(posts, 1); assert.equal(gets, 1); assert.equal(generations, 0);
        approved = true; restored.input.retryAt = 0; await restored.alarm(); await Promise.all(f.pending);
        assert.equal(posts, 1); assert.equal(generations, 1); assert.equal(calls.filter(path => path === '/quota/begin').length, 1);
        restored.room.generationJob = { status: 'submitting' };
        await restored.saveRoom();
        assert.equal(f.data.has('pendingInput'), false); assert.equal([...f.data.keys()].some(key => key.startsWith('image:')), false);
    } finally { globalThis.fetch = original; }
});

test('expired, staging and newly disabled private input jobs are cleaned without external moderation or GPU submission', async () => {
    const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Unexpected external request'); };
    try {
        for (const mode of ['expired', 'staging', 'blocked']) {
            const calls: string[] = [];
            const services = { idFromName: () => ({}), get: () => ({ fetch: async (r: Request) => { calls.push(new URL(r.url).pathname); return Response.json({ ok: true }); } }) };
            const f = await fixture('IDLE', { ...testModerationConfig, AI_PROVIDER: 'wan22', AI_GENERATION_RELEASE: mode === 'blocked' ? 'blocked' : undefined,
                SERVICES: services as never });
            const worker = f.worker as any, room = worker.room as Room;
            room.players[0].accountId = 'account-a';
            const input = await new PendingInputs(f.storage).create({ id: crypto.randomUUID(), code: room.code, creatorId: 'a', accountId: 'account-a', ballotId: room.ballotId, prompt: 'Private expired prompt' }, testImageData(832, 624));
            if (mode === 'expired') input.expiresAt = Date.now() - 1;
            if (mode === 'staging') input.stage = 'staging';
            await f.storage.put('pendingInput', input);
            room.state = 'GENERATING'; room.generationId = input.id; room.currentPrompt = input.prompt;
            await worker.saveRoom();
            const restored = await f.recreate() as any;
            if (restored.input) { restored.input.retryAt = 0; await restored.alarm(); await Promise.all(f.pending); }
            assert.equal(f.data.has('pendingInput'), false, mode);
            assert.equal([...f.data.keys()].some(key => key.startsWith('image:')), false, mode);
            assert.equal((f.data.get('room') as Room).state, 'IDLE', mode);
            assert.equal((f.data.get('room') as Room).currentPrompt, '', mode);
            assert.ok(!calls.includes('/quota/begin'), mode);
        }
    } finally { globalThis.fetch = original; }
});

test('approval arriving after the creator turn changes cannot restore private input or begin a generation', async () => {
    const original = globalThis.fetch; let notify!: () => void, complete!: () => void;
    const started = new Promise<void>(resolve => { notify = resolve; }), done = new Promise<void>(resolve => { complete = resolve; });
    const calls: string[] = [];
    globalThis.fetch = async (_url, options) => {
        notify(); await done;
        return Response.json({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', digest: new Headers(options?.headers).get('x-content-sha256'), status: 'pending' }, { status: 202 });
    };
    try {
        const services = { idFromName: () => ({}), get: () => ({ fetch: async (r: Request) => { calls.push(new URL(r.url).pathname); return Response.json({ ok: true }); } }) };
        const f = await fixture('IDLE', { ...testModerationConfig, MODERATION_URL: 'https://moderation.test/jobs/validate', AI_PROVIDER: 'wan22', SERVICES: services as never });
        const worker = f.worker as any, room = worker.room as Room; room.players[0].accountId = 'account-a';
        const input = await new PendingInputs(f.storage).create({ id: crypto.randomUUID(), code: room.code, creatorId: 'a', accountId: 'account-a', ballotId: room.ballotId, prompt: 'Safe pending prompt' }, testImageData(832, 624));
        room.state = 'GENERATING'; room.generationId = input.id; room.currentPrompt = input.prompt; await worker.saveRoom();
        const restored = await f.recreate() as any; restored.input.retryAt = 0;
        await restored.alarm(); await started;
        restored.room.state = 'IDLE'; restored.room.generationId = undefined; restored.room.currentPrompt = ''; restored.room.activeCreatorIndex = 1;
        await restored.saveRoom(); complete(); await Promise.all(f.pending);
        assert.equal(f.data.has('pendingInput'), false); assert.equal(f.data.has('moderation-checkpoints'), false);
        assert.ok(!calls.includes('/quota/begin')); assert.equal((f.data.get('room') as Room).activeCreatorIndex, 1);
    } finally { complete?.(); globalThis.fetch = original; }
});
