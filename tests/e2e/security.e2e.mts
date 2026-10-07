import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:3313';
for (let i = 0; i < 120; i++) {
    const response = await fetch(`${base}/api/config`);
    assert.equal(response.status, 200);
    const config = await response.json() as { mockAi: boolean };
    assert.equal(config.mockAi, true, 'Request-limit tests require mock mode.');
}
const blocked = await fetch(`${base}/api/config`);
assert.equal(blocked.status, 429);
assert.ok(Number(blocked.headers.get('retry-after')) > 0);
assert.equal(blocked.headers.get('cache-control'), 'no-store');
await blocked.arrayBuffer();
for (const path of ['/', '/style.css', '/assets/mock-video.mp4']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, 'Blocked API requests must not block page assets or playback.');
    await response.arrayBuffer();
}
for (let i = 0; i < 61; i++) {
    const response = await fetch(`${base}/api/session`, {
        method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: 'invalid-json'
    });
    assert.equal(response.status, i < 60 ? 400 : 429);
    if (i === 60) assert.ok(Number(response.headers.get('retry-after')) > 0);
    await response.arrayBuffer();
}
const stats = await fetch(`${base}/api/stats`);
assert.equal(stats.status, 200, 'Rate limits must be scoped to their route.');
assert.equal((await stats.json() as { databaseEnabled: boolean }).databaseEnabled, false);
console.log('PASS: HTTP bursts return 429 and Retry-After; page assets, video playback and unrelated routes remain available.');
