import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nodeHfStorage } from '../../src/auth/node-hf-storage';

const directory = await mkdtemp(join(tmpdir(), 'slop-startup-'));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert.ok(address && typeof address !== 'string');
await new Promise<void>(resolve => probe.close(() => resolve()));
const env = { ...process.env, PORT: String(address.port), DATABASE_URL: '', HF_TOKEN: '', AI_PROVIDER: 'mock', AUTH_MODE: 'disabled',
    NODE_INPUT_STORAGE_DIR: join(directory, 'inputs'), HF_LOCAL_STORAGE_DIR: join(directory, 'hf'),
    MODERATION_LOCAL_STORAGE_DIR: join(directory, 'moderation'), ARCHIVE_RESERVATIONS_LOCAL_STORAGE_DIR: join(directory, 'archive'),
    AUTH_COOKIE_SECRET: 'startup-test-cookie-secret-at-least-32-characters', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' };
const children: ReturnType<typeof spawn>[] = [];
function start() { const child = spawn(process.execPath, ['dist/server/node.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child); return child; }
try {
    const first = start();
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Startup timed out')), 15_000);
        first.stdout!.on('data', bytes => { if (String(bytes).includes('Server läuft')) { clearTimeout(timer); resolve(); } });
        first.once('error', reject); first.once('exit', () => { clearTimeout(timer); reject(new Error('First server exited')); });
    });
    const store = nodeHfStorage(env.NODE_INPUT_STORAGE_DIR);
    const input = { id: 'test-owned-job', image: { id: 'test-image', chunks: 1 } };
    await store.put('input-index', ['TEST']); await store.put('TEST:pendingInput', input); await store.put('TEST:image:test-image:0', 'private-safe-fixture');
    const second = start();
    const code = await Promise.race([once(second, 'exit').then(([code]) => code), new Promise((_, reject) => setTimeout(() => reject(new Error('Second server did not exit')), 10_000).unref())]);
    assert.equal(code, 1);
    assert.deepEqual(await store.get('TEST:pendingInput'), input);
    assert.equal(await store.get('TEST:image:test-image:0'), 'private-safe-fixture');
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/config`)).status, 200);
    console.log('PASS: occupied-port startup cannot clean another live Node server moderation jobs; isolated files and zero external calls.');
} finally {
    await Promise.all(children.map(async child => { if (child.exitCode === null && !child.signalCode) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } }));
    await rm(directory, { recursive: true, force: true });
}
