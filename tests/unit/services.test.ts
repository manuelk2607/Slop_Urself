import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableRounds, fetchGpuQuota, QuotaBudget, requiredGpuSeconds, roundsForPlayers, playerCount } from '../../src/ai/quota';
import { evictionPlan, archiveLimit, archiveVideo, serveVideo } from '../../src/storage/archive';
import { authDisabled, requestAccount, verifyAccountToken, sessionResponse } from '../../src/auth/session';
import { storedProfiles } from '../../src/auth/profiles';
import { SignJWT } from 'jose';
import { ServiceDurableObject } from '../../src/server/cloudflare/worker';
import { providerGpuSeconds } from '../../src/ai/providers';

test('live rounds respect GPU time, request quota, reservations and longer video duration', () => {
    const quota = { base: 300, current: 185.987, resetsAt: null, runs: { remaining: 7 } };
    const ltx = { AI_PROVIDER_CHAIN: 'ltx' };
    assert.equal(availableRounds(quota, 0, ltx), 1);
    assert.equal(availableRounds(quota, 1, ltx), 0);
    assert.equal(availableRounds({ ...quota, current: 300, runs: { remaining: 1 } }, 0, ltx), 1);
    assert.equal(availableRounds({ ...quota, current: 0 }, 0, {}), 0);
    assert.ok(requiredGpuSeconds(8) > requiredGpuSeconds(5));
    assert.equal(roundsForPlayers(1, 1), 1);
    assert.equal(roundsForPlayers(1, 2), 0);
    assert.equal(roundsForPlayers(6, 3), 2);
    assert.equal(roundsForPlayers(5, 3), 1);
    for (const invalid of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => playerCount(invalid));
});
test('full-round capacity and reservations include every player and release skipped videos', async () => {
    const original = globalThis.fetch;
    let seconds = 185;
    globalThis.fetch = async () => Response.json({ base: 720, current: seconds, resetsAt: null, runs: { remaining: 8 } });
    const data = new Map<string, any>();
    const budget = new QuotaBudget({ get: async (key: string) => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'ltx' });
    try {
        assert.equal((await budget.capacity(1)).aiRoundLimit, 1);
        const two = await budget.capacity(2);
        assert.equal(two.aiRoundLimit, 0); assert.equal(two.availableGenerations, 1); assert.equal(two.gpuSecondsPerRound, 240);
        await assert.rejects(budget.reserve('AAAA', 1, 2));
        seconds = 720;
        assert.equal((await budget.capacity(3)).aiRoundLimit, 2);
        await budget.reserve('AAAA', 2, 3);
        assert.equal(data.get('reservations').AAAA.rounds, 6);
        assert.equal((await budget.capacity(1)).aiRoundLimit, 0);
        await budget.begin('AAAA'); await budget.drop('AAAA', 1);
        assert.equal(data.get('reservations').AAAA.rounds, 5);
        await budget.release('AAAA');
        assert.equal(data.get('reservations').AAAA.rounds, 1);
        await budget.consume('AAAA');
        assert.equal((await budget.capacity(3)).aiRoundLimit, 2);
    } finally { globalThis.fetch = original; }
});
test('fallback capacity uses the cheapest five-second mode without adding shared HF budgets', async () => {
    assert.equal(providerGpuSeconds('wan22', {}), 154);
    assert.equal(providerGpuSeconds('wan22-fast', {}), 92);
    assert.equal(providerGpuSeconds('ltx', {}), 120);
    assert.equal(providerGpuSeconds('wan', {}), Infinity);
    assert.ok(providerGpuSeconds('wan22-fast', { LTX_DURATION: '8' }) > 92);
    const original = globalThis.fetch;
    let current = 185, remaining = 7;
    globalThis.fetch = async () => Response.json({ base: 300, current, resetsAt: null, runs: { remaining } });
    const data = new Map<string, any>();
    const storage = { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } };
    const config = { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' };
    const budget = new QuotaBudget(storage, config);
    try {
        const capacity = await budget.capacity(2);
        assert.equal(capacity.aiRoundLimit, 1); assert.equal(capacity.availableGenerations, 2);
        assert.equal(capacity.gpuSecondsPerRound, 184); assert.equal(capacity.sharedQuota, true);
        assert.deepEqual(capacity.providers?.map(provider => provider.gpuSeconds), [154, 92, 120]);
        assert.equal((await budget.capacity(3)).aiRoundLimit, 0);
        await assert.rejects(budget.reserve('AAAA', 2, 2));
        remaining = 1;
        assert.equal((await budget.capacity(2)).aiRoundLimit, 0);
        remaining = 7;
        assert.equal((await new QuotaBudget(storage, { ...config, AI_GPU_SECONDS_PER_ROUND: '120' }).capacity(2)).aiRoundLimit, 0);
        await budget.reserve('AAAA', 1, 2);
        assert.equal(data.get('reservations').AAAA.gpuSecondsPerVideo, 92);
        await budget.begin('AAAA', 2);
        await assert.rejects(budget.allowAttempt('AAAA', 154));
        await assert.rejects(budget.allowAttempt('AAAA', 120));
        await budget.allowAttempt('AAAA', 92);
        await budget.consume('AAAA'); current = 93;
        await budget.begin('AAAA', 1); await budget.allowAttempt('AAAA', 92);
        current = 0;
        await assert.rejects(budget.allowAttempt('AAAA', 92), 'A fallback has no separate free quota.');
    } finally { globalThis.fetch = original; }
});
test('quality upgrades protect simultaneous rooms even before HF charges in-flight jobs', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 300, current: 300, resetsAt: null, runs: { remaining: 8 } });
    const data = new Map<string, any>();
    const storage = { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } };
    const fast = new QuotaBudget(storage, { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' });
    const ltx = new QuotaBudget(storage, { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'ltx' });
    try {
        await fast.reserve('AAAA', 1); await fast.reserve('BBBB', 1);
        await fast.begin('AAAA'); await fast.begin('BBBB');
        await fast.allowAttempt('AAAA', 154);
        await assert.rejects(fast.allowAttempt('BBBB', 154));
        await fast.allowAttempt('BBBB', 92);
        assert.equal((await fast.capacity()).availableGenerations, 0);
        await fast.consume('AAAA'); await fast.consume('BBBB');
        await ltx.reserve('CCCC', 1);
        assert.equal((await fast.capacity()).availableGenerations, 1);
        await fast.reserve('DDDD', 1); await fast.begin('DDDD');
        await fast.allowAttempt('DDDD', 154);
        assert.equal(data.get('reservations').CCCC.gpuSecondsPerVideo, 120);
        await assert.rejects(fast.reserve('EEEE', 1));
    } finally { globalThis.fetch = original; }
});
test('overlapping jobs in one room hold individual costs and complete idempotently', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 430, current: 430, resetsAt: null, runs: { remaining: 8 } });
    const data = new Map<string, any>();
    const budget = new QuotaBudget({ get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'wan22,wan22-fast,ltx' });
    try {
        await budget.reserve('AAAA', 4);
        for (const job of ['a', 'b', 'c', 'd']) await budget.begin('AAAA', 1, job);
        await budget.allowAttempt('AAAA', 154, 'a');
        for (const job of ['b', 'c', 'd']) await budget.allowAttempt('AAAA', 92, job);
        await assert.rejects(budget.allowAttempt('AAAA', 154, 'b'));
        assert.equal((await budget.capacity()).availableGenerations, 0);
        await budget.consume('AAAA', 'a'); await budget.consume('AAAA', 'a');
        assert.equal(data.get('reservations').AAAA.active, 3);
        assert.equal(data.get('reservations').AAAA.rounds, 3);
        await assert.rejects(budget.allowAttempt('AAAA', 92, 'a'));
        assert.deepEqual(data.get('reservations').AAAA.activeJobs, { b: 92, c: 92, d: 92 });
    } finally { globalThis.fetch = original; }
});

test('additional rounds use actual remaining quota and retain abandoned in-flight jobs', async () => {
    const original = globalThis.fetch;
    let current = 300, remaining = 8;
    globalThis.fetch = async () => Response.json({ base: 300, current, resetsAt: null, runs: { remaining } });
    const data = new Map<string, any>();
    const budget = new QuotaBudget({ get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, { HF_TOKEN: 'test' });
    try {
        await budget.reserve('AAAA', 1, 2);
        for (let cycle = 0; cycle < 3; cycle++) {
            for (let video = 0; video < 2; video++) {
                await budget.begin('AAAA', 2 - video);
                await budget.allowAttempt('AAAA', 92);
                await budget.consume('AAAA'); current -= 20; remaining--;
            }
            await budget.release('AAAA');
            if (cycle < 2) await budget.extend('AAAA', 2);
        }
        assert.equal(current, 180); assert.equal(remaining, 2);
        assert.equal((await budget.capacity(2)).aiRoundLimit, 0);
        await assert.rejects(budget.extend('AAAA', 2));
        current = 300; remaining = 1;
        await assert.rejects(budget.extend('AAAA', 2));
        remaining = 8;
        await budget.reserve('BBBB', 1); await budget.begin('BBBB', 1, 'old');
        await budget.allowAttempt('BBBB', 154, 'old'); await budget.release('BBBB');
        await assert.rejects(budget.extend('BBBB', 2));
        current = 400; await budget.extend('BBBB', 2);
        assert.equal(data.get('reservations').BBBB.rounds, 3);
        assert.equal(data.get('reservations').BBBB.activeJobs.old, 154);
        await budget.consume('BBBB', 'old');
        assert.equal(data.get('reservations').BBBB.rounds, 2);
    } finally { globalThis.fetch = original; }
});
test('global Worker budget serializes simultaneous game starts and retains active abandoned jobs', async () => {
    const data = new Map<string, any>();
    const personal = await testHfPlayers(data, ['a']);
    const state = { storage: personal.storage };
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 300, current: 300, resetsAt: null, runs: { remaining: 8 } });
    try {
        const env = { ...personal.config, HF_TOKEN: 'must-never-be-used', AI_PROVIDER_CHAIN: 'ltx' };
        const worker = new ServiceDurableObject(state as any, env as any);
        const post = (path: string, body: unknown) => worker.fetch(new Request(`https://test/quota/${path}`, { method: 'POST', body: JSON.stringify(body) }));
        const starts = await Promise.all([post('reserve', { code: 'AAAA', rounds: 2, participants: personal.players }), post('reserve', { code: 'BBBB', rounds: 2, participants: personal.players })]);
        assert.deepEqual(starts.map(response => response.status), [200, 503]);
        assert.equal((await post('begin', { code: 'AAAA', jobId: 'job-a', playerId: 'a', participant: personal.players[0] })).status, 200);
        await post('release', { code: 'AAAA' });
        assert.equal(heldHfVideos(data), 1);
        await post('consume', { code: 'AAAA', jobId: 'job-a' });
        assert.equal(heldHfVideos(data), 0);
    } finally { globalThis.fetch = original; }
});
test('quota permission/network failures block new games rather than guessing a limit', async () => {
    const original = globalThis.fetch; globalThis.fetch = async () => new Response(null, { status: 403 });
    try {
        await assert.rejects(fetchGpuQuota({ HF_TOKEN: 'test' }));
        const budget = new QuotaBudget({ get: async () => undefined, put: async () => {} }, { HF_TOKEN: 'test' });
        assert.equal((await budget.capacity()).aiRoundLimit, 0);
    } finally { globalThis.fetch = original; }
});

test('display quota is briefly cached but starts always recheck the real budget', async () => {
    const original = globalThis.fetch;
    let current = 300, calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ base: 300, current, resetsAt: null }); };
    const data = new Map<string, any>();
    const budget = new QuotaBudget({ get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, { HF_TOKEN: 'test' });
    try {
        assert.equal((await budget.displayCapacity(2)).aiRoundLimit, 1);
        current = 50;
        assert.equal((await budget.displayCapacity(2)).aiRoundLimit, 1); assert.equal(calls, 1);
        await assert.rejects(budget.reserve('TEST', 1, 2)); assert.equal(calls, 2);
        assert.equal((await budget.displayCapacity(2)).aiRoundLimit, 0); assert.equal(calls, 3);
    } finally { globalThis.fetch = original; }
});
test('global Worker budget serializes simultaneous additional rounds across rooms', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 300, current: 300, resetsAt: null, runs: { remaining: 8 } });
    const data = new Map<string, any>();
    const personal = await testHfPlayers(data, ['a', 'b']);
    const worker = new ServiceDurableObject({ storage: personal.storage } as any, { ...personal.config, HF_TOKEN: 'must-never-be-used' } as any);
    try {
        const extend = (code: string) => worker.fetch(new Request('https://test/quota/extend', { method: 'POST', body: JSON.stringify({ code, players: 2, participants: personal.players }) }));
        const results = await Promise.all([extend('AAAA'), extend('BBBB')]);
        assert.deepEqual(results.map(result => result.status), [200, 503]);
        assert.equal(heldHfVideos(data), 2);
        assert.equal(data.get('quota-plan:BBBB'), undefined);
    } finally { globalThis.fetch = original; }
});
test('fallback attempts cannot spend the GPU budget reserved for later rounds', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ base: 300, current: 180, resetsAt: null, runs: { remaining: 7 } });
    const reservations = { AAAA: { rounds: 2, active: 1, expiresAt: Date.now() + 60_000, reset: null } };
    const budget = new QuotaBudget({ get: async () => structuredClone(reservations) as any, put: async () => {} }, { HF_TOKEN: 'test' });
    try { await assert.rejects(budget.allowAttempt('AAAA', 120)); }
    finally { globalThis.fetch = original; }
});
test('retries must restore the entire remaining game budget, not spend the next player\'s video', async () => {
    const original = globalThis.fetch;
    let current = 480;
    globalThis.fetch = async () => Response.json({ base: 480, current, resetsAt: null, runs: { remaining: 8 } });
    const data = new Map<string, any>();
    const budget = new QuotaBudget({ get: async (key: string) => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } }, { HF_TOKEN: 'test', AI_PROVIDER_CHAIN: 'ltx' });
    try {
        await budget.reserve('AAAA', 2, 2);
        await budget.begin('AAAA', 4); await budget.consume('AAAA');
        current = 360;
        await assert.rejects(budget.begin('AAAA', 4));
        assert.equal(data.get('reservations').AAAA.active, 0);
        current = 480;
        await budget.begin('AAAA', 4);
        assert.equal(data.get('reservations').AAAA.rounds, 4);
        assert.equal(data.get('reservations').AAAA.active, 1);
    } finally { globalThis.fetch = original; }
});
test('archive evicts oldest files only and stays capped below the free storage allowance', () => {
    const objects = [{ key: 'new', size: 30, modified: '2026-10-02' }, { key: 'old', size: 40, modified: '2026-10-01' }];
    assert.deepEqual(evictionPlan(objects, 50, 100).map(object => object.key), ['old']);
    assert.deepEqual(evictionPlan(objects, 20, 100), []);
    assert.deepEqual(evictionPlan(objects, 50, 100, new Set(['old'])).map(object => object.key), ['new']);
    assert.throws(() => evictionPlan(objects, 50, 100, new Set(['old', 'new'])), /Rückgängig/);
    assert.equal(archiveLimit({ VIDEO_ARCHIVE_MB: '99999' }), 1024 * 1024 * 1024);
});
test('archive reads real MP4 bytes and serves byte ranges through signed private S3 requests', async () => {
    const bytes = Uint8Array.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
    const original = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = async (input: any, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init); requests.push(request);
        if (request.url.includes('.hf.space')) return new Response(bytes, { headers: { 'content-type': 'video/mp4' } });
        if (request.url.includes('list-type')) return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
        if (request.method === 'PUT') return new Response(null, { status: 200 });
        return new Response(bytes.slice(0, 4), { status: 206, headers: { 'content-range': 'bytes 0-3/16', 'content-length': '4' } });
    };
    const config = { AI_PROVIDER: 'mock', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_ENDPOINT_URL_S3: 'https://storage.test', AWS_REGION: 'eu-central-1' };
    try {
        const url = await archiveVideo('https://demo.hf.space/video.mp4', config);
        assert.ok(url.startsWith('/api/videos/videos/'));
        const response = await serveVideo(new Request('https://game.test', { headers: { range: 'bytes=0-3' } }), url.slice('/api/videos/'.length), config);
        assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 4);
        assert.equal(response.headers.get('content-range'), 'bytes 0-3/16');
        assert.equal(requests.at(-1)?.headers.get('range'), 'bytes=0-3');
        assert.ok(requests.find(request => request.method === 'PUT')?.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256'));
        assert.equal(response.headers.get('content-disposition'), null);
        const download = await serveVideo(new Request('https://game.test/video?download=1'), url.slice('/api/videos/'.length), config);
        assert.match(download.headers.get('content-disposition')!, /^attachment; filename="slopurself-\d{13}-[a-z0-9-]+\.mp4"$/);
    } finally { globalThis.fetch = original; }
});
test('video delivery distinguishes an unconfigured archive, removed file and storage outage', async () => {
    const key = 'videos/1234567890123-test.mp4';
    const request = () => new Request('https://game.test');
    assert.equal((await serveVideo(request(), key, {})).status, 503);
    const original = globalThis.fetch;
    const config = { AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_ENDPOINT_URL_S3: 'https://storage.test' };
    try {
        globalThis.fetch = async () => new Response(null, { status: 404 });
        assert.equal((await serveVideo(request(), key, config)).status, 410);
        globalThis.fetch = async () => { throw new Error('Network down'); };
        assert.equal((await serveVideo(request(), key, config)).status, 503);
        globalThis.fetch = async () => new Response(null, { status: 416, headers: { 'content-range': 'bytes */16' } });
        const range = await serveVideo(request(), key, config);
        assert.equal(range.status, 416); assert.equal(range.headers.get('content-range'), 'bytes */16');
    } finally { globalThis.fetch = original; }
});
test('sessions reject missing or short signing keys before accessing profiles', async () => {
    let profileCalls = 0;
    const profiles = { create: async () => { profileCalls++; return undefined; }, find: async () => { profileCalls++; return undefined; } };
    const request = () => new Request('https://game.test/api/session', { method: 'POST', headers: { origin: 'https://game.test' }, body: JSON.stringify({ mode: 'refresh' }) });
    for (const AUTH_COOKIE_SECRET of [undefined, '', 'x'.repeat(31)]) {
        const response = await sessionResponse(request(), { AUTH_COOKIE_SECRET }, profiles);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'Die Browsersitzung ist noch nicht eingerichtet.' });
    }
    assert.equal((await sessionResponse(request(), { AUTH_COOKIE_SECRET: 'x'.repeat(32) }, profiles)).status, 401);
    assert.equal(profileCalls, 0);
});

test('username profiles reject duplicates, resume the same ID and verify browser sessions', async () => {
    const data = new Map<string, any>();
    const profiles = storedProfiles({ get: async key => data.get(key), put: async (key, value) => { data.set(key, value); } });
    const config = { AUTH_COOKIE_SECRET: 'test-only-cookie-secret-at-least-32-characters' };
    const enter = (username: string, mode = 'create', cookie?: string, origin = 'https://game.test') => sessionResponse(new Request('https://game.test/api/session', { method: 'POST', headers: { origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ username, mode }) }), config, profiles);
    const first = await enter('Player'); assert.equal(first.status, 200);
    const { account, token } = await first.json() as any;
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await requestAccount(new Request('https://game.test', { headers: { cookie } }), config))?.id, account.id);
    const duplicate = await enter(' player ');
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json() as any).error, /Melde dich mit dem vorhandenen Benutzer an/);
    assert.equal((await enter('Ｐｌａｙｅｒ')).status, 409);
    const resumed = await enter('PLAYER', 'login'); assert.equal(resumed.status, 200);
    assert.equal((await resumed.json() as any).account.id, account.id);
    const unknown = await enter('Unknown', 'login');
    assert.equal(unknown.status, 404);
    assert.match((await unknown.json() as any).error, /Neuen Benutzer registrieren/);
    assert.equal(await profiles.find('Unknown'), undefined);
    assert.equal((await enter('NewName', 'create', undefined, 'https://evil.test')).status, 403);
    assert.equal((await enter('ignored', 'refresh', cookie)).status, 200);
    assert.equal((await enter('ignored', 'refresh')).status, 401);
    await assert.rejects(verifyAccountToken(`${token}x`, config));
    await assert.rejects(verifyAccountToken(undefined, config));
    await assert.rejects(verifyAccountToken(token, { AUTH_COOKIE_SECRET: 'another-test-cookie-secret-at-least-32-characters' }));
    const expired = await new SignJWT({ name: 'Player', role: 'player' }).setSubject('profile-id').setProtectedHeader({ alg: 'HS256' }).setIssuer('slopurself').setAudience('game').setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(new TextEncoder().encode(config.AUTH_COOKIE_SECRET));
    await assert.rejects(verifyAccountToken(expired, config));
    assert.equal(authDisabled({ AUTH_MODE: 'disabled', AI_PROVIDER: 'wan22' }), false);
    const signedOut = await sessionResponse(new Request('https://game.test/api/session', { method: 'DELETE', headers: { origin: 'https://game.test' } }), config, profiles);
    assert.match(signedOut.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await profiles.find('player'))?.id, account.id, 'Signing out must not delete the profile.');
});

test('global Worker profile registry serializes same-name creation and survives recreation', async () => {
    const data = new Map<string, any>();
    const state = { storage: { get: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); } } };
    const worker = new ServiceDurableObject(state as any, { AI_PROVIDER: 'mock' } as any);
    const requests = ['Friend', ' friend '].map(name => worker.fetch(new Request('https://test/profiles/create', { method: 'POST', body: JSON.stringify({ name }) })));
    const results = await Promise.all((await Promise.all(requests)).map(response => response.json() as any));
    assert.equal(results.filter(result => result.profile).length, 1);
    const restored = new ServiceDurableObject(state as any, { AI_PROVIDER: 'mock' } as any);
    const response = await restored.fetch(new Request('https://test/profiles/find', { method: 'POST', body: JSON.stringify({ name: 'FRIEND' }) }));
    assert.equal((await response.json() as any).profile.id, results[0].profile.id);
});
import { testHfPlayers, heldHfVideos } from '../support/hf-fixture';
