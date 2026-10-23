import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { XMLParser } from 'fast-xml-parser';
import { artifactPath } from '../support/artifacts';

const base = process.argv[2] || 'http://127.0.0.1:3310';
const canonical = 'https://slopurself.maki26.workers.dev/';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH || undefined });
try {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 900 }, userAgent: 'Googlebot' });
    const page = await context.newPage();
    const response = await page.goto(base);
    assert.equal(response?.status(), 200);
    assert.match(await page.title(), /Slop Urself.*KI-Video-Partyspiel/);
    assert.ok((await page.locator('meta[name="description"]').getAttribute('content'))!.length > 100);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), canonical);
    assert.equal(await page.locator('meta[name="google-site-verification"]').getAttribute('content'), '9W8XeJ15-XfHaf0VmyCKn7QGze-upbYIM-X3Kk_LPwo');
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'index, follow, max-image-preview:large');
    assert.match(await page.locator('#aboutGame').innerText(), /zehn Spieler/);
    assert.equal(await page.locator('#aboutGame').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText())['@graph'];
    assert.deepEqual(graph.map((item: { '@type': string }) => item['@type']), ['WebSite', 'VideoGame']);
    const image = await page.request.get((await page.locator('meta[property="og:image"]').getAttribute('content'))!.replace(canonical, base + '/'));
    assert.equal(image.status(), 200); assert.match(image.headers()['content-type'], /image\/png/);
    const sitemap = await page.request.get(base + '/sitemap.xml');
    assert.equal(sitemap.status(), 200); assert.match(sitemap.headers()['content-type'], /xml/);
    assert.equal(new XMLParser().parse(await sitemap.text()).urlset.url.loc, canonical);
    const robots = await page.request.get(base + '/robots.txt');
    assert.equal(robots.status(), 200); assert.match(robots.headers()['content-type'], /text\/plain/);
    assert.match(await robots.text(), /Disallow: \/api\//); assert.match(await robots.text(), /Sitemap: https:\/\/slopurself\.maki26\.workers\.dev\/sitemap.xml/);
    for (const path of ['/api/config', '/api/not-found']) {
        const api = await page.request.get(base + path);
        assert.match(api.headers()['x-robots-tag'], /noindex/);
        assert.equal(api.headers()['cache-control'], 'no-store');
    }
    assert.equal((await page.request.get(base + '/missing-public-page')).status(), 404);
    await page.screenshot({ path: artifactPath(`slopurself-public-mobile-${new URL(base).port}.png`), fullPage: true });
    console.log('PASS: public crawlable HTML without JavaScript, metadata, Google verification, structured data, sitemap, robots and private-response noindex on ' + base);
} finally { await browser.close(); }
