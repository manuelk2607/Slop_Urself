import assert from 'node:assert/strict';
import { artifactPath } from '../support/artifacts';
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
    let configRequests = 0;
    await quota.route('**/api/config', route => {
        configRequests++;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authEnabled: false, mockAi: false, quotaMode: 'unavailable', aiRoundLimit: 0 }) });
    });
    await quota.goto(base); await quota.locator('#screenLobby').waitFor({ state: 'visible' });
    assert.equal(await quota.locator('#roundCountInput, #roundLimitHint').count(), 0);
    assert.equal(await quota.locator('#screenLobby input[type="number"]').count(), 0);
    assert.equal(await quota.locator('#createRoomButton').isEnabled(), true);
    assert.equal(await quota.locator('#joinRoomButton').isEnabled(), true);
    assert.equal(await quota.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await quota.screenshot({ path: artifactPath('slopurself-home-mobile.png'), fullPage: true });
    await quota.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await quota.locator('#usernameInput').fill('RoundHost');
    await quota.locator('#createRoomButton').click();
    await quota.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    assert.equal(await quota.locator('#roomRoundCountInput').inputValue(), '1');
    const maximum = Number(await quota.locator('#roomRoundCountInput').getAttribute('max'));
    assert.ok(maximum >= 1);
    await quota.locator('#roomRoundCountInput').fill('100'); await quota.locator('#roomRoundCountInput').blur();
    await quota.waitForFunction(limit => (document.getElementById('roomRoundCountInput') as HTMLInputElement).value === String(limit), maximum);
    assert.equal(configRequests, 1, 'The homepage must not fetch or poll a separate round limit.');
    assert.equal(await quota.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await quota.screenshot({ path: artifactPath('slopurself-quota-mobile.png'), fullPage: true });
    console.log('PASS: missing bundle/backend show errors; round selection exists only inside the room, defaults to one and clamps to the server limit; homepage does not poll quota; mobile layout fits.');
} finally { await browser.close(); }
