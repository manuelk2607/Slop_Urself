import assert from 'node:assert/strict';
import { cloudflareRuntime } from '../support/cloudflare';

// Real workerd crypto + persisted local profile DO; all external calls denied.
const runtime = await cloudflareRuntime({ bindings: { AUTH_MODE: '' } });
try {
    const base = String(await runtime.ready).replace(/\/$/, '');
    const password = 'local-runtime-password-123';
    const session = (mode: string, value?: string) => fetch(`${base}/api/session`, { method: 'POST',
        headers: { origin: base, 'content-type': 'application/json' },
        body: JSON.stringify({ mode, username: 'KdfRuntime', ...(value === undefined ? {} : { password: value }) }) });
    const created = await session('create', password); assert.equal(created.status, 200);
    const initial = await created.json() as { account: { id: string }; identityVerified: boolean };
    assert.ok(initial.identityVerified); const id = initial.account.id;
    assert.doesNotMatch(JSON.stringify(initial), /passwordHash|pbkdf2|local-runtime-password/);
    const missing = await session('login'); assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, 'password_required');
    assert.equal((await session('login', 'different-runtime-password')).status, 401);
    const valid = await session('login', password); assert.equal(valid.status, 200);
    assert.equal((await valid.json()).account.id, id);
    await runtime.unsafeEvictDurableObject('slopurself-test', 'ServiceDurableObject', { name: 'global' });
    const restored = await session('login', password); assert.equal(restored.status, 200);
    assert.equal((await restored.json()).account.id, id);
    console.log('PASS: versioned optional passwords use real workerd PBKDF2, reject missing/wrong passwords and retain the profile after eviction; no external services.');
} finally { await runtime.dispose(); }
