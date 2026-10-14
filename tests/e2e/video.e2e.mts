import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { artifactPath } from '../support/artifacts';

const base = process.argv[2] || 'http://127.0.0.1:3310';
const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
try {
    await page.goto(base);
    await page.locator('#usernameInput').fill('SoloPlayback');
    await page.locator('#createRoomButton').click();
    await page.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    await page.locator('#startGameButton').click();
    await page.locator('#creatorControls').waitFor({ state: 'visible' });
    let fail = true;
    await page.route('**/assets/mock-video.mp4', route => fail
        ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporarily unavailable' })
        : route.continue());
    await page.locator('#imageInput').setInputFiles({ name: 'test.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7VQAAAAASUVORK5CYII=', 'base64') });
    await page.locator('#promptInput').fill('The subject waves.');
    await page.locator('#uploadButton').click();
    await page.locator('#videoPlaybackNotice').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#videoPlaybackNotice').innerText()).length > 10);
    assert.equal(await page.locator('#retryVideoButton').isVisible(), true);
    await page.screenshot({ path: artifactPath('slopurself-video-error-mobile.png'), fullPage: true });
    fail = false;
    await page.locator('#retryVideoButton').click();
    await page.waitForFunction(() => (document.getElementById('votingVideoPlayer') as HTMLVideoElement).currentTime > 0.3);
    await page.locator('#videoPlaybackNotice').waitFor({ state: 'hidden' });
    await page.unroute('**/assets/mock-video.mp4');
    await page.reload();
    await page.locator('#screenVoting').waitFor({ state: 'visible' });
    await page.waitForTimeout(11_000);
    assert.equal(await page.locator('#screenVoting').isVisible(), true, 'A solo preview must not finish on a timer, including after reload.');
    assert.equal(await page.locator('#screenGameOver').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: artifactPath('slopurself-video-solo-mobile.png'), fullPage: true });
    await page.locator('#finishPreviewButton').click();
    await page.locator('#screenGameOver').waitFor({ state: 'visible' });
    await page.locator('#restartButton').click();
    await page.locator('#screenLobby').waitFor({ state: 'visible' });

    const archived = '/api/videos/videos/1234567890123-test.mp4';
    let archiveDown = true;
    await page.route(`**${archived}`, async route => {
        if (archiveDown) await route.fulfill({ status: 503 });
        else await route.fulfill({ response: await route.fetch({ url: `${base}/assets/mock-video.mp4` }) });
    });
    await page.route('**/api/stats', route => route.fulfill({ json: {
        databaseEnabled: true, videoStorageMode: 'archive', overview: {}, players: [],
        recentVideos: [{ roomCode: 'TEST', roundNumber: 1, creatorName: 'SoloPlayback', prompt: 'The subject waves.',
            videoUrl: archived, roundPoints: 0, createdAt: '2026-10-13T00:00:00Z' }]
    } }));
    await page.locator('#statsButton').click();
    const clip = page.locator('#videoStatsList video');
    await clip.waitFor();
    await clip.evaluate((video: HTMLVideoElement) => video.play().catch(() => {}));
    const notice = page.locator('#videoStatsList [role="alert"]');
    await notice.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#videoStatsList [role="alert"]')?.textContent?.includes('Videoarchiv'));
    archiveDown = false;
    await page.getByRole('button', { name: 'Video erneut laden', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('#videoStatsList video') as HTMLVideoElement).readyState >= 2);
    await notice.waitFor({ state: 'hidden' });
    await clip.evaluate((video: HTMLVideoElement) => { video.currentTime = 2; });
    await page.waitForFunction(() => (document.querySelector('#videoStatsList video') as HTMLVideoElement).currentTime >= 2);
    assert.deepEqual(errors, []);
    console.log('PASS: failed video load is visible and retry plays; solo preview survives reload and waits for confirmation; archived statistics video retries and seeks.');
} catch (error) {
    await page.screenshot({ path: artifactPath('slopurself-video-failed.png'), fullPage: true });
    throw error;
} finally { await browser.close(); }
