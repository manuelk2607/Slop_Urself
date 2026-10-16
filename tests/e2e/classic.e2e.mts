import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, webkit, type Page } from 'playwright';
import { artifactPath } from '../support/artifacts';
import { testImage } from '../support/images';

const base = process.argv[2] || 'http://127.0.0.1:3312';
const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const contexts = await Promise.all([false, true].map(mobile => browser.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 } })));
const pages = await Promise.all(contexts.map(context => context.newPage()));
const [host, guest] = pages;
const names = [`cH_${randomUUID().slice(0, 8)}`, `cG_${randomUUID().slice(0, 8)}`];
const errors: string[] = [];
const visible = (page: Page, id: string) => page.locator(`#${id}`).waitFor({ state: 'visible' });
for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
}
async function upload(page: Page, portrait: boolean) {
    await visible(page, 'creatorControls');
    assert.equal(await page.locator('#personalImagePicker').isVisible(), true);
    for (const id of ['secretTask', 'sharedCreationImage']) assert.equal(await page.locator(`#${id}`).isVisible(), false);
    await page.locator('#imageInput').setInputFiles({ name: 'own-picture.png', mimeType: 'image/png', buffer: testImage(portrait ? 320 : 480, portrait ? 480 : 320) });
    await page.locator('#imagePreview').waitFor({ state: 'visible' });
    const preview = await page.locator('#imagePreview').getAttribute('src');
    assert.match(preview!, /^data:image\/jpeg;base64,/);
    await page.locator('#promptInput').fill(portrait ? 'The subject jumps.' : 'The subject waves.');
    await page.locator('#uploadButton').click();
    await Promise.all(pages.map(player => visible(player, 'screenVoting')));
    for (const player of pages) for (const id of ['guessEntry', 'taskVoteControls', 'guessReview']) assert.equal(await player.locator(`#${id}`).isVisible(), false);
    return preview;
}
try {
    const config = await (await host.request.get(`${base}/api/config`)).json();
    assert.equal(config.mockAi, true); assert.equal(config.authEnabled, true, 'Mock videos must not require disabling normal profiles.');
    for (const [index, page] of pages.entries()) {
        await page.goto(base); await visible(page, 'screenAuth');
        assert.equal(await page.locator('#authForm input').count(), 1);
        assert.equal(await page.locator('#authForm input[type=password]').count(), 0);
        await page.locator('#authUsername').fill(names[index]); await page.locator('#authSubmit').click();
        await visible(page, 'screenLobby');
        assert.equal(await page.locator('#usernameInput').isVisible(), false, 'The normal profile replaces the legacy lobby-name field.');
        assert.equal(await page.locator('#accountName').innerText(), names[index]);
    }
    const account = (await (await host.request.get(`${base}/api/session`)).json()).account;
    await host.locator('#signOutButton').click(); await visible(host, 'screenAuth');
    await host.locator('#existingNameButton').click(); await visible(host, 'screenLobby');
    assert.equal((await (await host.request.get(`${base}/api/session`)).json()).account.id, account.id);
    await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
    const code = await host.locator('#displayRoomCode').innerText();
    await guest.locator('#signOutButton').click(); await visible(guest, 'screenAuth');
    await guest.goto(`${base}/?room=${code}`); await visible(guest, 'screenAuth');
    await guest.locator('#authUsername').fill(names[1]); await guest.locator('#existingNameButton').click(); await visible(guest, 'screenLobby');
    assert.equal(await guest.locator('#roomCodeInput').inputValue(), code, 'An invitation survives normal login.');
    await guest.locator('#joinRoomButton').click(); await visible(guest, 'screenRoomLobby');
    assert.equal(new URL(guest.url()).searchParams.has('room'), false, 'Consumed invitations cannot rejoin an old room after leaving.');
    for (const page of pages) {
        assert.equal(await page.locator('#gameModeName').innerText(), 'Klassisch');
        assert.equal(await page.locator('#variantSettings').getAttribute('open'), null);
        for (const id of ['sharedImageOption', 'secretTasksOption', 'guessPromptOption']) assert.equal(await page.locator(`#${id}`).evaluate((input: HTMLInputElement) => input.checked), false);
    }
    await host.locator('#generationQuality').selectOption('economy');
    await host.locator('#variantSettingsLabel').click();
    for (const id of ['sharedImageOption', 'secretTasksOption', 'guessPromptOption']) await host.locator(`#${id}`).check();
    await host.waitForFunction(() => document.getElementById('gameModeName')?.textContent === 'Mit Zusatzregeln');
    assert.equal(await host.locator('#startGameButton').isDisabled(), true);
    assert.equal(await guest.locator('#classicModeButton').isVisible(), false);
    await host.locator('#classicModeButton').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => document.getElementById('gameModeName')?.textContent === 'Klassisch')));
    assert.equal(await host.locator('#generationQuality').inputValue(), 'economy', 'Classic resets optional rules, not AI quality.');
    assert.equal(await host.locator('#variantSettings').getAttribute('open'), null);
    await host.reload(); await visible(host, 'screenRoomLobby');
    assert.equal(await host.locator('#accountName').innerText(), names[0]);
    assert.equal(await host.locator('#gameModeName').innerText(), 'Klassisch');
    await host.screenshot({ path: artifactPath('slopurself-classic-lobby-desktop.png'), fullPage: true });
    await guest.screenshot({ path: artifactPath('slopurself-classic-lobby-mobile.png'), fullPage: true });
    await host.locator('#startGameButton').click();
    const first = await upload(host, false);
    assert.equal(await guest.locator('.vote-buttons').isVisible(), true);
    await guest.locator('[data-points="4"]').click(); await visible(host, 'screenResult');
    assert.match(await host.locator('#resultPointsSummary').innerText(), /4 Punkte/);
    await host.locator('#nextRoundButton').click(); await visible(guest, 'creatorControls');
    await guest.screenshot({ path: artifactPath('slopurself-classic-upload-mobile.png'), fullPage: true });
    const second = await upload(guest, true); assert.notEqual(first, second, 'Each creator uses a separate picture.');
    await host.locator('[data-points="3"]').click(); await Promise.all(pages.map(page => visible(page, 'screenGameOver')));
    assert.match(await host.locator('#winnerName').innerText(), /4 Punkten/);
    assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await host.locator('#restartButton').click(); await visible(host, 'screenLobby');
    await host.reload(); await visible(host, 'screenLobby');
    assert.equal(await host.locator('#accountName').innerText(), names[0]);
    await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
    assert.equal(await host.locator('#gameModeName').innerText(), 'Klassisch');
    assert.equal(await host.locator('#variantSettings').getAttribute('open'), null);
    await host.locator('#leaveRoomButton').click(); await visible(host, 'screenLobby');
    await guest.locator('#leaveRoomButton').click(); await visible(guest, 'screenLobby');
    assert.deepEqual(errors, []);
    console.log('PASS: normal username profiles with mock AI, profile reuse/reload, classic default/reset, separate pictures and prompts per creator, ordinary votes and no bonus phases; desktop/mobile.');
} catch (error) {
    for (const [index, page] of pages.entries()) await page.screenshot({ path: artifactPath(`slopurself-classic-failed-${index}.png`), fullPage: true });
    throw error;
} finally { await browser.close(); }
