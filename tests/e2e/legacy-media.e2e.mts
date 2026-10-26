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
    await page.route(source, route => route.fulfill({ status: 200, contentType: 'video/mp4', body: bytes }));
    await page.goto(base);
    const response = page.waitForResponse(source, { timeout: 10_000 });
    await page.evaluate(src => {
        const video = document.createElement('video'); video.preload = 'metadata'; video.src = src; document.body.append(video);
    }, source);
    assert.equal((await response).status(), 200, 'CSP must preserve existing HF-hosted archive URLs.');
    const headers = (await page.request.get(base)).headers();
    const media = headers['content-security-policy'].split(';').find(part => part.trim().startsWith('media-src'))!;
    assert.match(media, /https:\/\/\*\.hf\.space/);
    assert.ok(!/(^|\s)https:\s/.test(media), 'Do not allow arbitrary remote video hosts.');
    console.log('PASS: existing HF-hosted clips remain compatible with CSP; only local video fixtures used.');
} finally { await browser.close(); }
