import assert from 'node:assert/strict';
import { XMLValidator, XMLParser } from 'fast-xml-parser';
import { releaseId } from '../src/security/release.js';

// Read-only production probes. No signup, room creation, OAuth, inference,
// deletion or access to existing player records. Run after Wrangler deploy.
const origin = new URL(process.argv[2] || '');
const expected = releaseId(process.argv[3]);
assert.ok(origin.protocol === 'https:' && origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password);
assert.ok(expected, 'Pass the deployed Worker version ID.');
const probes: { path: string; status: number }[] = [];
async function get(path: string, agent?: string) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20_000),
        headers: { ...(agent ? { 'user-agent': agent } : {}), 'cache-control': 'no-cache' } });
    probes.push({ path, status: response.status }); return response;
}
const release = await get('/api/release');
assert.equal(release.status, 200); assert.equal(release.headers.get('cache-control'), 'no-store');
assert.equal((await release.json() as { release?: string }).release, expected);
const page = await get('/'); assert.equal(page.status, 200);
assert.equal(page.headers.get('x-slop-release'), expected);
assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
const html = await page.text(); assert.match(html, /google-site-verification/);
assert.match(html, /<link rel="canonical"/); assert.match(html, /<html lang="de"/);
for (const agent of [undefined, 'Googlebot/2.1 (+http://www.google.com/bot.html)']) {
    const robots = await get('/robots.txt', agent); assert.equal(robots.status, 200);
    assert.match(robots.headers.get('content-type') || '', /^text\/plain(?:;|$)/);
    const text = await robots.text(); assert.match(text, /Allow: \//); assert.match(text, /Disallow: \/api\//);
    assert.ok(text.includes(`Sitemap: ${origin.origin}/sitemap.xml`));
    const sitemap = await get('/sitemap.xml', agent); assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get('content-type') || '', /^(application|text)\/xml(?:;|$)/);
    const xml = await sitemap.text(); assert.equal(XMLValidator.validate(xml), true);
    assert.equal(new XMLParser().parse(xml).urlset.url.loc, origin.origin + '/');
}
const config = await get('/api/config'); assert.equal(config.status, 200);
const settings = await config.json() as { authEnabled?: boolean; hfRequired?: boolean; mockAi?: boolean; aiRoundLimit?: number; generationBlocked?: boolean; quotaMode?: string };
assert.equal(settings.authEnabled, true); assert.equal(settings.hfRequired, true); assert.equal(settings.mockAi, false);
assert.equal(settings.aiRoundLimit, 0, 'Anonymous clients cannot query a personal budget.');
assert.equal(settings.generationBlocked, true, 'This release must explicitly expose the production inference hold.');
assert.equal(settings.quotaMode, 'unavailable');
for (const path of ['/api/session', '/api/stats', '/api/stats/videos', '/api/stats/rooms', '/api/rooms/0000/image', '/ws/0000']) {
    const response = await get(path); assert.ok([401, 403].includes(response.status), path);
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
}
const forged = await fetch(new URL('/api/session', origin), { method: 'POST', redirect: 'manual',
    headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'create', username: 'NeverCreated' }), signal: AbortSignal.timeout(20_000) });
assert.equal(forged.status, 403, 'Foreign-origin registration rejected before writes.');
const producer = await fetch(new URL('/api/producer/claim', origin), { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permit: 'deliberately-invalid-test-permit' }), signal: AbortSignal.timeout(20_000) });
assert.equal(producer.status, 503, 'Blocked release must never acknowledge a producer GPU claim.');
assert.equal((await producer.json() as { error?: string }).error, 'producer_claim_rejected');
probes.push({ path: '/api/producer/claim', status: producer.status });
console.info(JSON.stringify({ release: expected, origin: origin.origin, probes, foreignOriginRejected: true,
    producerGpuClaimRejected: true,
    generationHoldExposed: settings.generationBlocked,
    inferenceCalls: 0, databaseWrites: 0, limitations: ['No authenticated positive multiplayer or real GPU/billing test.', 'Googlebot user-agent is not evidence of a real Google crawl.'] }, null, 2));
