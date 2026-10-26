import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { testImage } from '../support/images';
const base = process.argv[2] || 'http://127.0.0.1:3310';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 375, height: 812 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
    await page.goto(base); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    async function contrast(selector: string) {
        const colors = await page.locator(selector).evaluate(element => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
        const luminance = (color: string) => {
            const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const a = luminance(colors.text), b = luminance(colors.background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    for (const selector of ['#createRoomButton', '#joinRoomButton']) {
        assert.ok(await contrast(selector) >= 4.5, `${selector} default contrast`);
        await page.locator(selector).hover(); assert.ok(await contrast(selector) >= 4.5, `${selector} hover contrast`);
        await page.locator(selector).evaluate((button: HTMLButtonElement) => { button.disabled = true; });
        assert.ok(await contrast(selector) >= 4.5, `${selector} disabled contrast`);
        await page.locator(selector).evaluate((button: HTMLButtonElement) => { button.disabled = false; });
    }
    await page.locator('#usernameInput').fill('AccessTest'); await page.locator('#createRoomButton').click();
    await page.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#screenRoomLobby').evaluate(el => el.contains(document.activeElement)), true);
    await page.locator('#startGameButton').click(); await page.locator('#creatorControls').waitFor({ state: 'visible' });
    const before = await page.locator('#leaveRoomButton').boundingBox(); assert.ok(before);
    await page.locator('#imageInput').setInputFiles({ name: 'public-fixture.png', mimeType: 'image/png', buffer: testImage(320, 240) });
    await page.locator('#imagePreview').waitFor({ state: 'visible' });
    await page.locator('#promptInput').fill('The subject waves.'); await page.locator('#uploadButton').click();
    await page.locator('#screenVoting').waitFor({ state: 'visible' });
    await page.waitForFunction(() => (document.getElementById('votingVideoPlayer') as HTMLVideoElement).readyState >= 2);
    assert.equal(await page.locator('#votingVideoPlayer').evaluate((v: HTMLVideoElement) => v.paused), true, 'Reduced motion disables automatic video playback.');
    assert.equal(await page.locator('#votingVideoPlayer').getAttribute('autoplay'), null);
    const after = await page.locator('#leaveRoomButton').boundingBox(); assert.ok(after);
    assert.ok(Math.abs(before.y - after.y) < 2, 'Room controls must not jump when the voting panel appears.');
    assert.equal(await page.locator('.spinner').first().evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.locator('#retryVideoButton').evaluate((button: HTMLButtonElement) => { button.hidden = false; });
    await page.locator('#retryVideoButton').click();
    await page.waitForFunction(() => (document.getElementById('votingVideoPlayer') as HTMLVideoElement).currentTime > 0.2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#leaveRoomButton').click(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    console.log('PASS: button contrast, screen focus, reduced motion, manual playback/retry, stationary room controls and mobile width.');
} finally { await browser.close(); }
