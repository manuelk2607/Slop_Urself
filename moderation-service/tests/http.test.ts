import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { moderationServer } from '../src/http.js';
import { POLICY_VERSION } from '../src/policy.js';
test('HTTP protocol authenticates, binds decisions and separates evaluation from qualified approval', async t => {
    let qualified = false, calls = 0;
    const secret = 'protocol-test-only-secret-at-least-32-characters', version = 'a'.repeat(64);
    const server = moderationServer({ secret, version, qualified: () => qualified, engine: () => ({
        input: async () => { calls++; return { decision: 'allow', decodeComplete: true }; }, output: async () => ({ decision: 'review' })
    }) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const body = JSON.stringify({ stage: 'input', image: 'test-fixture-only', prompt: 'benign', policyVersion: POLICY_VERSION, modelVersion: version });
    const digest = createHash('sha256').update(body).digest('hex');
    const post = (path: string, token = secret, hash = digest) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-content-sha256': hash }, body });
    assert.deepEqual(await (await fetch(base + '/health')).json(), { ready: false });
    assert.equal((await post('/validate', 'wrong')).status, 401);
    assert.equal((await post('/validate')).status, 503); assert.equal(calls, 0);
    assert.equal((await (await post('/evaluate')).json() as { evaluationOnly: boolean }).evaluationOnly, true);
    qualified = true;
    assert.equal((await post('/validate', secret, 'wrong')).status, 503);
    const result = await (await post('/validate')).json() as { digest: string; evaluationOnly?: boolean };
    assert.equal(result.digest, digest); assert.equal(result.evaluationOnly, undefined); assert.equal(calls, 2);
});

test('inference is cancelled on deadline and an expired qualification cannot approve completed work', async t => {
    const secret = 'deadline-test-only-secret-at-least-32-characters', version = 'b'.repeat(64);
    let qualified = true, cancelled = false, mode: 'wait' | 'expire' | 'normal' = 'wait';
    const server = moderationServer({ secret, version, timeoutMs: 50, qualified: () => qualified, engine: () => ({
        input: async (_image, _prompt, signal) => {
            if (mode === 'wait') await new Promise((_, reject) => signal!.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); }, { once: true }));
            if (mode === 'expire') qualified = false;
            return { decision: 'allow', decodeComplete: true };
        }, output: async () => ({ decision: 'review' })
    }) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const body = JSON.stringify({ stage: 'input', image: 'test-only', prompt: 'benign', policyVersion: POLICY_VERSION, modelVersion: version });
    const post = () => fetch(`http://127.0.0.1:${address.port}/validate`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'x-content-sha256': createHash('sha256').update(body).digest('hex') }, body });
    assert.equal((await post()).status, 503); assert.equal(cancelled, true);
    mode = 'expire'; assert.equal((await post()).status, 503);
    mode = 'normal'; qualified = true; assert.equal((await post()).status, 200);
});
