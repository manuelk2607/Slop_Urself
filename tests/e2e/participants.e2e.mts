import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, webkit, type Page } from 'playwright';
import { artifactPath } from '../support/artifacts';
import { testImage } from '../support/images';
const base = process.argv[2] || 'http://127.0.0.1:3312';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const pages: Page[] = [], errors: string[] = [];
const visible = (page: Page, id: string) => page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 20000 });
const password = 'optional-profile-test-password';
let expectedDenial = false;
try {
    for (let i = 0; i < 3; i++) {
        const page = await (await browser.newContext({ viewport: i === 2 ? { width: 320, height: 740 } : { width: 1280, height: 900 } })).newPage(); pages.push(page);
        page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { if (!expectedDenial || !/Zuschauer/.test(d.message())) errors.push(d.message()); void d.dismiss(); });
        await page.addInitScript(() => {
            const send = WebSocket.prototype.send;
            let wire: WebSocket | undefined, native = true;
            WebSocket.prototype.send = function (data) {
                if (typeof data === 'string' && (data.startsWith('42[') || data.startsWith('{"type":'))) { wire = this; native = data.startsWith('{'); }
                return send.call(this, data);
            };
            (window as any).testGameCommand = (type: string, payload: unknown) => {
                if (!wire) throw new Error('No connected game transport');
                send.call(wire, native ? JSON.stringify({ type, payload }) : `42${JSON.stringify([type, payload])}`);
            };
        });
        await page.goto(base); await visible(page, 'screenAuth');
        await page.locator('#authUsername').fill(`p${i}_${randomUUID().slice(0, 8)}`);
        if (i === 0) { await page.locator('#authPasswordSection summary').click(); await page.locator('#authPassword').fill(password); }
        await page.locator('#authSubmit').click(); await visible(page, 'screenLobby');
        assert.equal(await page.locator('#authPassword').inputValue(), '');
    }
    const [host, guest, viewer] = pages;
    await host.locator('#signOutButton').click(); await visible(host, 'screenAuth');
    await host.locator('#existingNameButton').click(); await visible(host, 'authPassword');
    assert.match(await host.locator('#authError').innerText(), /geschützt/);
    await host.locator('#authPassword').fill(password); await host.locator('#existingNameButton').click(); await visible(host, 'screenLobby');
    await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
    const oldCode = await host.locator('#displayRoomCode').innerText();
    await guest.locator('#roomCodeInput').fill(oldCode); await guest.locator('#joinRoomButton').click(); await visible(guest, 'screenRoomLobby');
    await host.waitForFunction(() => document.querySelectorAll('#lobbyPlayerList li').length === 2);
    await host.locator('#requireReadyOption').check();
    await host.waitForFunction(() => (document.getElementById('startGameButton') as HTMLButtonElement).disabled);
    await host.locator('#readyInput').check(); await guest.locator('#readyInput').check();
    await host.waitForFunction(() => !(document.getElementById('startGameButton') as HTMLButtonElement).disabled);
    await host.locator('#phaseSeconds').selectOption('60');
    await Promise.all([host, guest].map(p => p.waitForFunction(() => !(document.getElementById('readyInput') as HTMLInputElement).checked)));
    await host.locator('#readyInput').check(); await guest.locator('#readyInput').check();
    await host.locator('#startGameButton').click(); await visible(host, 'creatorControls');
    // Spectators may join after the game has already started.
    await viewer.locator('#roomCodeInput').fill(oldCode); await viewer.locator('#watchRoomButton').click(); await visible(viewer, 'waitControls');
    await visible(viewer, 'spectatorRole'); assert.equal(await viewer.locator('#creatorControls').isVisible(), false);
    await host.waitForFunction(() => document.getElementById('spectatorCount')?.textContent === '1');
    expectedDenial = true;
    for (const type of ['sendImage', 'submitVote', 'setGameOptions', 'setReady', 'startGame']) {
        const denied = viewer.waitForEvent('dialog');
        await viewer.evaluate(({ type, code }) => (window as any).testGameCommand(type, { roomId: code, points: 5, ready: true }), { type, code: oldCode });
        assert.match((await denied).message(), /Zuschauer/);
    }
    expectedDenial = false;
    const oldSessions = await Promise.all(pages.map(p => p.evaluate(() => localStorage.getItem('slopurself-session'))));
    for (let i = 0; i < 2; i++) {
        const creator = pages[i], voter = pages[1 - i];
        await visible(creator, 'creatorControls');
        await creator.locator('#imageInput').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: testImage(320, 320) });
        await creator.locator('#promptInput').fill('The cube rotates.'); await creator.locator('#uploadButton').click();
        await Promise.all(pages.map(p => visible(p, 'screenVoting')));
        assert.equal(await viewer.locator('#votingActionBox').isVisible(), false); assert.equal(await viewer.locator('#finishPreviewButton').isVisible(), false);
        if (!i) { await viewer.reload(); await visible(viewer, 'screenVoting'); assert.equal(await viewer.locator('#votingActionBox').isVisible(), false); }
        await viewer.locator('#votingVideoPlayer').evaluate(async (v: HTMLVideoElement) => { v.muted = true; await v.play(); });
        await viewer.waitForFunction(() => (document.getElementById('votingVideoPlayer') as HTMLVideoElement).currentTime > 0);
        await voter.locator('[data-points="4"]').click(); await Promise.all(pages.map(p => visible(p, i ? 'screenGameOver' : 'screenResult')));
        if (!i) await host.locator('#nextRoundButton').click();
    }
    assert.equal(await viewer.locator('#finalScoreList li').count(), 2);
    assert.equal(await guest.locator('#rematchGameButton').isVisible(), false);
    await host.locator('#rematchGameButton').click();
    await Promise.all(pages.map(p => visible(p, 'screenRoomLobby')));
    // Reconnects are independent: wait for the complete roster on every browser.
    for (const page of pages) await page.waitForFunction(() => document.getElementById('playerCount')?.textContent === '2' && document.getElementById('spectatorCount')?.textContent === '1');
    const newCode = await host.locator('#displayRoomCode').innerText(); assert.notEqual(newCode, oldCode);
    for (const [i, page] of pages.entries()) {
        assert.equal(await page.locator('#displayRoomCode').innerText(), newCode);
        assert.notEqual(await page.evaluate(() => localStorage.getItem('slopurself-session')), oldSessions[i]);
        assert.equal(await page.locator('#phaseSeconds').inputValue(), '60');
        assert.equal(await page.locator('#readyInput').isChecked(), false);
    }
    assert.equal(await viewer.locator('#readyControl').isVisible(), false);
    assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await viewer.screenshot({ path: artifactPath('slopurself-spectator-rematch-mobile.png'), fullPage: true });
    await guest.reload(); await visible(guest, 'screenRoomLobby');
    await host.locator('#leaveRoomButton').click(); await visible(host, 'screenLobby');
    await guest.locator('#leaveRoomButton').click(); await Promise.all([guest, viewer].map(p => visible(p, 'screenLobby')));
    assert.deepEqual(errors, []);
    console.log('PASS: optional password login, ready reset/gating, in-game spectators, playback/reload, fresh rematch sessions, complete reconnected roster and last-player cleanup on desktop/mobile.');
} catch (error) {
    for (const [i, page] of pages.entries()) await page.screenshot({ path: artifactPath(`slopurself-participants-failed-${i}.png`), fullPage: true }); throw error;
} finally { await browser.close(); }
