import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:3310';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const page = await browser.newPage();
try {
    // Only a local public fixture is served. No request reaches Hugging Face.
    const bytes = await readFile('public/assets/mock-video.mp4');
    const source = 'https://legacy.hf.space/public-fixture.mp4';
    let allowedRequests = 0, forbiddenRequests = 0;
    await page.route(source, route => { allowedRequests++; return route.fulfill({ status: 200, contentType: 'video/mp4', body: bytes }); });
    const forbidden = 'https://unapproved.invalid/public-fixture.mp4';
    // An accidentally broadened policy must still never send external traffic.
    await page.route(forbidden, route => { forbiddenRequests++; return route.fulfill({ status: 200, contentType: 'video/mp4', body: bytes }); });
    await page.goto(base);
    await page.evaluate(() => {
        const violations: { blockedURI: string; directive: string }[] = [];
        Object.defineProperty(window, '__mediaPolicyViolations', { value: violations });
        window.addEventListener('securitypolicyviolation', event => violations.push({ blockedURI: event.blockedURI, directive: event.effectiveDirective }));
    });
    const response = page.waitForResponse(source, { timeout: 10_000 });
    await page.evaluate(src => {
        const video = document.createElement('video'); video.preload = 'metadata'; video.src = src; document.body.append(video);
    }, source);
    await response;
    // Native WebKit media responses can report status 0 for intercepted files.
    // CSP is proved by the actual permitted request plus a blocked-host control,
    // not by accepting status 0 as successful playback (tested separately).
    assert.ok(allowedRequests > 0, 'CSP must allow the HF media request to reach the fixture.');
    const allowedViolations = await page.evaluate(() => Reflect.get(window, '__mediaPolicyViolations') as { blockedURI: string; directive: string }[]);
    assert.equal(allowedViolations.filter(v => v.directive === 'media-src').length, 0);
    await page.evaluate(src => { const video = document.createElement('video'); video.preload = 'metadata'; video.src = src; document.body.append(video); }, forbidden);
    await page.waitForFunction(() => (Reflect.get(window, '__mediaPolicyViolations') as { blockedURI: string; directive: string }[])
        .some(v => v.directive === 'media-src' && v.blockedURI.startsWith('https://unapproved.invalid')), undefined, { timeout: 10_000 });
    assert.equal(forbiddenRequests, 0, 'CSP must reject unapproved hosts before network interception.');
    const headers = (await page.request.get(base)).headers();
    const media = headers['content-security-policy'].split(';').find(part => part.trim().startsWith('media-src'))!;
    assert.match(media, /https:\/\/\*\.hf\.space/);
    assert.ok(!/(^|\s)https:\s/.test(media), 'Do not allow arbitrary remote video hosts.');
    console.log('PASS: CSP permits HF archive requests and blocks unapproved hosts before network; local media fixtures only.');
} finally { await browser.close(); }
