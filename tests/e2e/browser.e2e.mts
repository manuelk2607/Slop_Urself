import assert from 'node:assert/strict';
import { artifactPath } from '../support/artifacts';
import { chromium, webkit, Page } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3311';
const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const errors: string[] = [];
const contexts = await Promise.all([0, 1, 2].map(i => browser.newContext({ viewport: i === 1 ? { width: 375, height: 812 } : { width: 1280, height: 900 } })));
const pages = await Promise.all(contexts.map(c => c.newPage()));
const snapshots = new Map<Page, unknown>();
for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
    page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
        try {
            const message = JSON.parse(String(payload));
            if (message.type === 'roomDataUpdate') snapshots.set(page, message.payload);
        } catch {}
    }));
}
const [host, guest, third] = pages;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7VQAAAAASUVORK5CYII=', 'base64');
const visible = (page: Page, id: string) => page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 15_000 });
const upload = async (page: Page) => {
    await page.locator('#imageInput').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
    await page.locator('#promptInput').fill('The subject waves.');
    await page.locator('#uploadButton').click();
};

try {
    const config = await (await host.request.get(`${base}/api/config`)).json();
    assert.equal(config.mockAi, true, 'Browser regression tests require mock mode.');
    await Promise.all(pages.map(p => p.goto(base)));
    for (const [selector, signature] of [
        ['link[rel="icon"][href="/favicon.ico"]', '00000100'],
        ['link[rel="icon"][type="image/png"]', '89504e47'],
        ['link[rel="apple-touch-icon"]', '89504e47']
    ]) {
        const href = await host.locator(selector).getAttribute('href');
        assert.ok(href);
        const response = await host.request.get(new URL(href, base).href);
        assert.equal(response.status(), 200);
        assert.match(response.headers()['content-type'], /^image\//);
        assert.equal((await response.body()).subarray(0, 4).toString('hex'), signature);
    }
    const icon = await host.evaluate(async () => {
        const image = new Image();
        image.src = (document.querySelector('link[rel="icon"][type="image/png"]') as HTMLLinkElement).href;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.deepEqual(icon, { width: 32, height: 32 });
    console.log('PASS: favicon and Safari touch icon are served as images and decode correctly.');
    assert.equal(await host.locator('#screenLobby input[type="number"]').count(), 0);
    assert.equal(await host.locator('#roundLimitHint').count(), 0);
    await host.locator('#usernameInput').fill('Host');
    await host.locator('#createRoomButton').click();
    await visible(host, 'screenRoomLobby');
    assert.equal(await host.locator('#roomRoundCountInput').inputValue(), '1');
    const code = await host.locator('#displayRoomCode').innerText();
    for (const [page, name] of [[guest, 'Guest'], [third, 'Third']] as const) {
        await page.locator('#usernameInput').fill(name);
        await page.locator('#roomCodeInput').fill(code);
        await page.locator('#joinRoomButton').click();
        await visible(page, 'screenRoomLobby');
    }
    assert.equal(await host.locator('#roomRoundLimitHint').innerText(), `Aktuell maximal ${config.aiRoundLimit} Runden.`);
    assert.equal(await guest.locator('#roomRoundCountInput').isDisabled(), true);
    await host.locator('#roomRoundCountInput').fill('2');
    await host.locator('#roomRoundCountInput').blur();
    await guest.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).value === '2');
    await host.locator('#startGameButton').click();
    await Promise.all(pages.map(p => visible(p, 'screenCreate')));
    await upload(host);
    await Promise.all(pages.map(p => visible(p, 'screenVoting')));
    await host.waitForFunction(() => (document.getElementById('votingVideoPlayer') as HTMLVideoElement).readyState >= 2);
    const video = await host.locator('#votingVideoPlayer').evaluate((v: HTMLVideoElement) => ({ width: v.videoWidth, duration: v.duration, paused: v.paused }));
    assert.ok(video.width > 0 && video.duration >= 5 && !video.paused, JSON.stringify(video));
    await guest.locator('[data-points="4"]').click();
    await guest.reload();
    await visible(guest, 'screenVoting');
    assert.equal(await guest.locator('#votingActionBox').isVisible(), false, 'Reload must retain the submitted vote.');
    await third.locator('[data-points="5"]').click();
    await Promise.all(pages.map(p => visible(p, 'screenResult')));
    assert.match(await host.locator('#resultPointsSummary').innerText(), /9/);
    await host.reload();
    await visible(host, 'screenResult');
    assert.match(await host.locator('#resultPointsSummary').innerText(), /9/);
    await host.locator('#nextRoundButton').click();
    await visible(guest, 'creatorControls');
    await upload(guest);
    await Promise.all(pages.map(p => visible(p, 'screenVoting')));
    await Promise.all([host.locator('[data-points="3"]').click(), third.locator('[data-points="2"]').click()]);
    await Promise.all(pages.map(p => visible(p, 'screenResult')));
    for (const [creator, votes, round, turn] of [[third, [1, 1], 1, 3], [host, [2, 2], 2, 1], [guest, [1, 1], 2, 2], [third, [1, 1], 2, 3]] as const) {
        await host.locator('#nextRoundButton').click();
        await visible(creator, 'creatorControls');
        assert.equal(await creator.locator('#roundCounter').innerText(), `${round}/2`);
        assert.equal(await creator.locator('#turnCounter').innerText(), `${turn}/3`);
        await upload(creator);
        await Promise.all(pages.map(p => visible(p, 'screenVoting')));
        await creator.waitForFunction(() => !(document.getElementById('votingVideoPlayer') as HTMLVideoElement).paused);
        await Promise.all(pages.filter(p => p !== creator).map((p, index) => p.locator(`[data-points="${votes[index]}"]`).click()));
        await Promise.all(pages.map(p => visible(p, round === 2 && turn === 3 ? 'screenGameOver' : 'screenResult')));
    }
    assert.match(await guest.locator('#winnerName').innerText(), /Host.*13/);
    await host.locator('#restartButton').click();
    await visible(host, 'screenLobby');
    await host.reload();
    await visible(host, 'screenLobby');
    assert.equal(await host.locator('#gameHeader').isVisible(), false);
    console.log('PASS: 3-player game, 2 complete rounds / 6 videos, repeated playback, simultaneous votes, reload in voting/results, restart.');

    for (const page of [guest, third]) { await page.locator('#leaveRoomButton').click(); await visible(page, 'screenLobby'); }
    await host.locator('#usernameInput').fill('Host');
    await guest.locator('#usernameInput').fill('Guest');
    await host.locator('#createRoomButton').click();
    await visible(host, 'screenRoomLobby');
    const secondCode = await host.locator('#displayRoomCode').innerText();
    await guest.locator('#roomCodeInput').fill(secondCode);
    await guest.locator('#joinRoomButton').click();
    await visible(guest, 'screenRoomLobby');
    await host.locator('#startGameButton').click();
    await visible(host, 'creatorControls');
    // An unrelated membership update must not clear an image already selected by the creator.
    await host.locator('#imageInput').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
    await host.locator('#promptInput').fill('The subject waves.');
    await guest.reload(); await visible(guest, 'screenCreate');
    assert.equal(await host.locator('#imageInput').evaluate((i: HTMLInputElement) => i.files?.length), 1);
    assert.equal(await host.locator('#promptInput').inputValue(), 'The subject waves.');
    await host.locator('#uploadButton').click();
    await host.locator('#leaveRoomButton').click();
    await visible(host, 'screenLobby');
    await visible(guest, 'creatorControls');
    assert.equal(await guest.locator('#screenVoting').isVisible(), false);
    console.log('PASS: creator leaves during generation; next creator can submit; unrelated snapshots preserve selected image.');

    if (config.aiProvider === 'mock' && base.includes('3311')) {
        const session = await guest.evaluate(() => JSON.parse(localStorage.getItem('slopurself-session')!));
        const before = await guest.locator('#creatorControls').innerText();
        await contexts[1].setOffline(true);
        await guest.evaluate(() => window.dispatchEvent(new Event('offline')));
        await contexts[1].setOffline(false);
        await guest.waitForFunction(() => document.getElementById('roomNotice')?.innerText === 'Verbindung wiederhergestellt.', undefined, { timeout: 15_000 });
        assert.deepEqual(await guest.evaluate(() => JSON.parse(localStorage.getItem('slopurself-session')!)), session);
        assert.equal(await guest.locator('#creatorControls').innerText(), before);
        console.log('PASS: native WebSocket reconnect restores the existing player session.');
    }
    await guest.locator('#leaveRoomButton').click(); await visible(guest, 'screenLobby');
    await guest.route('**/api/stats', route => route.fulfill({ json: {
        databaseEnabled: true, videoStorageMode: 'url',
        overview: { gamesPlayed: 20, completedGames: 18, roundsPlayed: 90, votesCast: 800, videosArchived: 90, highestScore: 95 },
        players: [{ name: 'LangerSpielerABC', gamesPlayed: 20, wins: 8, roundsCreated: 25, totalScore: 500, averageScore: 25, averageReceivedPoints: 20, votesGiven: 30, averageVoteGiven: 3.5 }],
        recentVideos: [{ roomCode: 'TEST', roundNumber: 1, creatorName: 'LangerSpielerABC', prompt: 'Ein sehr langer Prompt mit einer klaren Bewegung in der Originalszene.', videoUrl: '/assets/mock-video.mp4', roundPoints: 20, createdAt: '2026-10-06T10:00:00Z' }]
    } }));
    await guest.locator('#statsButton').click(); await visible(guest, 'screenStats');
    await guest.locator('#statsList .score-item').waitFor();
    const overflow = await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, 'Mobile UI must not overflow.');
    await guest.screenshot({ path: artifactPath('slopurself-mobile.png'), fullPage: true });
    await host.screenshot({ path: artifactPath('slopurself-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: no JavaScript errors; mobile layout stays within viewport.');
} catch (error) {
    for (const [index, page] of pages.entries()) {
        console.error(JSON.stringify({ index, snapshot: snapshots.get(page), screen: await page.locator('.game-screen:visible').getAttribute('id'), errors }));
        await page.screenshot({ path: artifactPath(`slopurself-failed-${index}.png`), fullPage: true });
    }
    throw error;
} finally { await browser.close(); }
