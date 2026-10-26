import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtimeVersion } from '../src/version.js';
test('running implementation and dependency lock produce a stable complete fingerprint', async () => {
    const lock = JSON.parse(await readFile('model-lock.json', 'utf8'));
    const version = await runtimeVersion(lock);
    assert.match(version, /^[a-f0-9]{64}$/);
    assert.equal(version, await runtimeVersion(lock));
    assert.notEqual(version, await runtimeVersion({ ...lock, vlm: { ...lock.vlm, revision: 'a'.repeat(40) } }));
});
