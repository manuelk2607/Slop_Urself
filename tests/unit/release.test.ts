import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { releaseId, releaseResponse } from '../../src/security/release';
import worker from '../../src/server/cloudflare/worker';
import { logAiEvent } from '../../src/ai/telemetry';
test('only actual deployment identifiers reach release headers; query redaction is configured', async () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    assert.equal(releaseId(id), id); assert.equal(releaseId('a'.repeat(40)), 'a'.repeat(40));
    for (const value of ['token=secret', 'arbitrary-release-tag', '', undefined, 'a'.repeat(1000)]) assert.equal(releaseId(value), undefined);
    const env = { CF_VERSION_METADATA: { id }, ASSETS: { fetch: async () => new Response('public') } };
    const response = await worker.fetch(new Request('https://game.test/robots.txt'), env as never);
    assert.equal(response.status, 200); assert.equal(response.headers.get('X-Slop-Release'), id);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    const config = await readFile('cloudflare/wrangler.toml', 'utf8');
    assert.match(config, /\[observability\][\s\S]*?redact_query_string = true/);
    assert.match(config, /\[version_metadata\]\s*binding = "CF_VERSION_METADATA"/);
});
test('release correlation never logs unvalidated environment values', () => {
    const original = console.info, lines: string[] = [];
    console.info = value => lines.push(String(value));
    try {
        logAiEvent('attempt', { releaseId: 'a'.repeat(40) });
        logAiEvent('attempt', { releaseId: 'secret=query&token=private' });
        assert.equal(JSON.parse(lines[0]).releaseId, 'a'.repeat(40));
        assert.equal(JSON.parse(lines[1]).releaseId, undefined);
        assert.doesNotMatch(lines.join(''), /secret|private/);
    } finally { console.info = original; }
});

test('release probe bypasses account/services dependencies and never caches or fabricates missing versions', async () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const response = await worker.fetch(new Request('https://game.test/api/release'), { CF_VERSION_METADATA: { id } } as never);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { release: id });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('X-Robots-Tag') || '', /noindex/);
    assert.equal(releaseResponse('POST', id).status, 405);
    assert.equal(await releaseResponse('HEAD', id).text(), '');
    const missing = releaseResponse('GET', 'token=private');
    assert.equal(missing.status, 503); assert.deepEqual(await missing.json(), { release: null });
});
