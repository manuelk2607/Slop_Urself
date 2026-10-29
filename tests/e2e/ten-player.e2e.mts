import assert from 'node:assert/strict';
import { chromium, webkit, type Page } from 'playwright';
import { testImage } from '../support/images';
import { artifactPath } from '../support/artifacts';

const base = process.argv[2] || 'http://127.0.0.1:3310';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const visible = (page: Page, id: string) => page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 20000 });
try {
    const pages: Page[] = [], errors: string[] = [];
    for (let i = 0; i < 10; i++) {
        const page = await (await browser.newContext({ reducedMotion: 'reduce', viewport: i === 9 ? { width: 375, height: 812 } : { width: 1280, height: 900 } })).newPage();
        page.on('pageerror', error => errors.push(error.message)); pages.push(page);
        await page.goto(base); await page.locator('#usernameInput').fill(`TenPlayer${i}`);
    }
    const host = pages[0]; await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
    const code = await host.locator('#displayRoomCode').innerText();
    for (const guest of pages.slice(1)) {
        await guest.locator('#roomCodeInput').fill(code); await guest.locator('#joinRoomButton').click(); await visible(guest, 'screenRoomLobby');
    }
    await host.waitForFunction(() => document.getElementById('playerCount')?.textContent === '10');
    await host.locator('#phaseSeconds').selectOption('60'); await host.locator('#startGameButton').click();
    await visible(host, 'creatorControls');
    // Only the host can skip; replaying a stale command must not skip the following turn.
    assert.equal(await pages[1].locator('#closePhaseButton').isVisible(), false);
    host.once('dialog', dialog => dialog.accept()); await host.locator('#closePhaseButton').click(); await visible(host, 'screenResult');
    await host.locator('#nextRoundButton').click();
    for (let i = 1; i < 10; i++) {
        const creator = pages[i]; await visible(creator, 'creatorControls');
        await creator.locator('#imageInput').setInputFiles({ name: 'public-fixture.png', mimeType: 'image/png', buffer: testImage(320, 240) });
        await creator.locator('#promptInput').fill(`The subject waves, turn ${i}.`); await creator.locator('#uploadButton').click();
        await Promise.all(pages.map(page => visible(page, 'screenVoting')));
        if (i === 1) { await pages[9].reload(); await visible(pages[9], 'screenVoting'); }
        for (const [voter, page] of pages.entries()) if (voter !== i) await page.locator('[data-points="4"]').click();
        await creator.waitForFunction(() => document.getElementById('votingStatusText')?.textContent?.includes('9/9'));
        assert.equal(await creator.locator('#screenVoting').isVisible(), true, 'All votes still preserve the creator preview.');
        await creator.locator('#finishPreviewButton').click();
        await Promise.all(pages.map(page => visible(page, i === 9 ? 'screenGameOver' : 'screenResult')));
        if (i !== 9) await host.locator('#nextRoundButton').click();
    }
    for (const page of pages) assert.match(await page.locator('#winnerName').innerText(), /36 Punkten/);
    assert.equal(await pages[9].evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await pages[9].screenshot({ path: artifactPath('slopurself-ten-player-mobile.png'), fullPage: true });
    for (const page of pages) { await page.locator('#leaveRoomButton').click(); await visible(page, 'screenLobby'); }
    assert.deepEqual(errors, []); console.log('PASS: ten isolated simultaneous players, host skip, nine sequential mock videos, 81 votes, reload and identical final standings; desktop/mobile.');
} finally { await browser.close(); }
