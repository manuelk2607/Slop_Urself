import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { testImage } from '../support/images';
const base = process.argv[2] || 'http://127.0.0.1:3310';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const contexts = await Promise.all([0,1,2].map(() => browser.newContext({ reducedMotion: 'reduce' })));
const pages = await Promise.all(contexts.map(c => c.newPage())); const [host, guest, third] = pages;
const errors: string[] = []; pages.forEach(p => p.on('pageerror', e => errors.push(e.message)));
const visible = (p: typeof host, id: string) => p.locator(`#${id}`).waitFor({ state: 'visible' });
try {
    for (const [i,p] of pages.entries()) { await p.goto(base); await p.locator('#usernameInput').fill(`View${i}`); }
    await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
    const code = await host.locator('#displayRoomCode').innerText();
    for (const p of [guest,third]) { await p.locator('#roomCodeInput').fill(code); await p.locator('#joinRoomButton').click(); await visible(p, 'screenRoomLobby'); }
    await host.locator('#startGameButton').click(); await visible(host, 'creatorControls');
    await host.locator('#imageInput').setInputFiles({ name: 'safe.png', mimeType: 'image/png', buffer: testImage(320,240) });
    await visible(host, 'imagePreview'); await host.locator('#promptInput').fill('The subject waves.'); await host.locator('#uploadButton').click();
    await Promise.all(pages.map(p => visible(p, 'screenVoting')));
    await guest.locator('[data-points="5"]').click(); await third.locator('#abstainVoteButton').click();
    await third.waitForFunction(() => document.getElementById('votingStatusText')?.textContent?.includes('Enthaltung gespeichert'));
    await host.waitForFunction(() => document.getElementById('votingStatusText')?.textContent?.includes('2/2'));
    assert.equal(await host.locator('#screenVoting').isVisible(), true, 'Votes cannot skip the creator preview.');
    assert.equal(await host.locator('#votingVideoPlayer').evaluate((v: HTMLVideoElement) => v.paused), true);
    await host.reload(); await visible(host, 'screenVoting');
    await host.locator('#finishPreviewButton').click(); await Promise.all(pages.map(p => visible(p, 'screenResult')));
    assert.match(await host.locator('#resultPointsSummary').innerText(), /5 Punkte.*1 Enthaltung/);
    await host.locator('#nextRoundButton').click(); await visible(guest, 'creatorControls');
    await guest.route('**/assets/mock-video.mp4', r => r.fulfill({ status: 503, body: 'test fixture unavailable' }));
    await guest.locator('#imageInput').setInputFiles({ name: 'safe.png', mimeType: 'image/png', buffer: testImage(320,240) });
    await visible(guest, 'imagePreview'); await guest.locator('#promptInput').fill('The subject waves.'); await guest.locator('#uploadButton').click();
    await visible(guest, 'videoPlaybackNotice');
    await host.locator('#abstainVoteButton').click(); await third.locator('#abstainVoteButton').click();
    await guest.waitForFunction(() => document.getElementById('votingStatusText')?.textContent?.includes('2/2'));
    await guest.locator('#finishPreviewButton').click(); await Promise.all(pages.map(p => visible(p, 'screenResult')));
    assert.match(await guest.locator('#resultPointsSummary').innerText(), /0 Punkte.*2 Enthaltungen/);
    await host.locator('#nextRoundButton').click(); await visible(third, 'creatorControls');
    await third.locator('#imageInput').setInputFiles({ name: 'safe.png', mimeType: 'image/png', buffer: testImage(320,240) });
    await visible(third, 'imagePreview'); await third.locator('#promptInput').fill('The subject waves.'); await third.locator('#uploadButton').click();
    await visible(host, 'screenVoting'); await visible(guest, 'screenVoting');
    await guest.locator('[data-points="4"]').click(); await guest.locator('#leaveRoomButton').click(); await visible(guest, 'screenLobby');
    await host.locator('#abstainVoteButton').click(); await host.locator('#leaveRoomButton').click(); await visible(host, 'screenLobby');
    await third.waitForFunction(() => document.getElementById('votingStatusText')?.textContent?.includes('2/2'));
    assert.equal(await third.locator('#screenVoting').isVisible(), true);
    await third.locator('#finishPreviewButton').click(); await visible(third, 'screenGameOver');
    assert.match(await third.locator('#finalScoreList').innerText(), /4 Pkt/);
    assert.deepEqual(errors, []);
    console.log('PASS: rapid votes wait for creator preview across reload; explicit abstention and failed playback resolve without false ratings.');
} finally { await browser.close(); }
