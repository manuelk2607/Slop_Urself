import assert from 'node:assert/strict';
import { artifactPath } from './artifacts';
import { chromium, webkit } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3310';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
try {
    const broken = await browser.newPage();
    await broken.route('**/script.js', route => route.abort());
    await broken.goto(base);
    await broken.locator('#screenStartup').waitFor({ state: 'visible' });
    assert.match(await broken.locator('#startupStatus').innerText(), /konnte nicht geladen/);
    const unavailable = await browser.newPage();
    await unavailable.route('**/api/config', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await unavailable.goto(base); await unavailable.locator('#screenAuth').waitFor({ state: 'visible' });
    assert.match(await unavailable.locator('#authError').innerText(), /nicht erreichbar/);
    const quota = await browser.newPage({ viewport: { width: 375, height: 812 } });
    let remaining = 1;
    await quota.route('**/api/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authEnabled: false, mockAi: false, quotaMode: 'live', aiRoundLimit: remaining, remainingGpuSeconds: remaining * 120 }) }));
    await quota.goto(base); await quota.locator('#screenLobby').waitFor({ state: 'visible' });
    assert.equal(await quota.locator('#roundCountInput').getAttribute('max'), '1');
    await quota.locator('#roundCountInput').fill('100'); await quota.locator('#roundCountInput').blur();
    assert.equal(await quota.locator('#roundCountInput').inputValue(), '1');
    remaining = 0;
    await quota.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await quota.waitForFunction(() => (document.getElementById('createRoomButton') as HTMLButtonElement).disabled);
    assert.equal(await quota.locator('#roundCountInput').inputValue(), '0');
    assert.equal(await quota.locator('#joinRoomButton').isEnabled(), true);
    assert.equal(await quota.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await quota.screenshot({ path: artifactPath('slopurself-quota-mobile.png'), fullPage: true });
    console.log('PASS: missing bundle and backend show errors; real quota clamps rounds and blocks creation at zero; mobile layout fits.');
} finally { await browser.close(); }
