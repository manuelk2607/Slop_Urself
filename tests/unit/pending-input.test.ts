import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingInputs } from '../../src/security/pending-input';
import { readSharedImage } from '../../src/game/images';
import { testImageData } from '../support/images';

test('private image intent precedes chunks; recreation reads the same image and cleanup removes every chunk', async () => {
    const data = new Map<string, unknown>(), events: string[] = [];
    const storage = { get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
        put: async (key: string, value: unknown) => { events.push(key); data.set(key, structuredClone(value)); },
        delete: async (key: string) => data.delete(key) };
    const inputs = new PendingInputs(storage);
    const value = await inputs.create({ id: crypto.randomUUID(), code: 'TEST', creatorId: 'a', accountId: 'account-a', prompt: 'harmless', ballotId: 'ballot' }, testImageData(832, 624));
    assert.equal(events[0], 'pendingInput'); assert.ok(events[1].startsWith('image:'));
    assert.equal(value.stage, 'checking'); assert.ok(value.expiresAt <= Date.now() + 360_000);
    assert.ok((await readSharedImage(storage, value.image)).startsWith('data:image/png;base64,'));
    assert.equal((await new PendingInputs(storage).load())?.id, value.id);
    await assert.rejects(inputs.create({ ...value }, testImageData(8, 8)), /bereits/);
    await inputs.remove({ ...value, id: 'stale-id' }); assert.ok(await inputs.load());
    await inputs.remove(value); assert.equal(data.size, 0);
});

test('partial private uploads clean up their durable intent and image chunks', async () => {
    const data = new Map<string, unknown>();
    const storage = { get: async <T>(key: string) => data.get(key) as T | undefined,
        put: async (key: string, value: unknown) => { if (key.startsWith('image:')) throw new Error('Storage unavailable'); data.set(key, value); },
        delete: async (key: string) => data.delete(key) };
    await assert.rejects(new PendingInputs(storage).create({ id: 'job', code: 'TEST', creatorId: 'a', accountId: 'account-a', prompt: 'safe' }, testImageData(832, 624)), /Storage unavailable/);
    assert.equal(data.size, 0);
});
