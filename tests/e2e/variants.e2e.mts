import assert from 'node:assert/strict';
import { chromium, webkit, type Page } from 'playwright';
import { artifactPath } from '../support/artifacts';
import { testImage } from '../support/images';

const base = process.argv[2] || 'http://127.0.0.1:3310';
const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const contexts = await Promise.all([0, 1, 2].map(index => browser.newContext({ viewport: index === 1 ? { width: 375, height: 812 } : { width: 1280, height: 900 } })));
const pages = await Promise.all(contexts.map(context => context.newPage()));
const [host, guest, third] = pages, errors: string[] = [];
for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
}
const visible = (page: Page, id: string) => page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 15000 });
const file = { name: 'shared.png', mimeType: 'image/png', buffer: testImage(700, 550, true) };
const createVideo = async (page: Page, prompt: string) => {
    await visible(page, 'creatorControls');
    assert.equal(await page.locator('#personalImagePicker').isVisible(), false);
    assert.ok((await page.locator('#secretTask').innerText()).length > 10);
    await page.locator('#promptInput').fill(prompt); await page.locator('#uploadButton').click();
    await Promise.all(pages.map(p => visible(p, 'screenVoting')));
};
const rate = async (page: Page, task: number, fun: number, guess = '') => {
    await page.locator('#guessInput').fill(guess);
    await page.locator('#taskRating').fill(String(task)); await page.locator('#funRating').fill(String(fun));
    await page.locator('#submitTaskVote').click();
};
try {
    for (const [index, page] of pages.entries()) { await page.goto(base); await page.locator('#usernameInput').fill(['VariantHost', 'VariantGuest', 'VariantThird'][index]); }
    await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
    const code = await host.locator('#displayRoomCode').innerText();
    for (const page of [guest, third]) { await page.locator('#roomCodeInput').fill(code); await page.locator('#joinRoomButton').click(); await visible(page, 'screenRoomLobby'); }
    assert.equal(await guest.locator('#sharedImageOption').isDisabled(), true);
    await host.locator('#variantSettingsLabel').click();
    await host.locator('#sharedImageOption').check();
    await host.locator('#secretTasksOption').check(); await host.locator('#guessPromptOption').check();
    await host.locator('#generationQuality').selectOption('economy');
    await guest.waitForFunction(() => ['sharedImageOption', 'secretTasksOption', 'guessPromptOption'].every(id => (document.getElementById(id) as HTMLInputElement).checked));
    assert.equal(await host.locator('#startGameButton').isDisabled(), true);
    await host.locator('#sharedImageInput').setInputFiles(file);
    await host.waitForFunction(() => document.getElementById('sharedImageStatus')?.textContent === 'Bild bereit.');
    const imageUrl = await host.locator('#sharedImagePreview').getAttribute('src'); assert.ok(imageUrl);
    const response = await host.request.get(`${base}${imageUrl}`); assert.equal(response.status(), 200);
    assert.match(response.headers()['cache-control'], /no-store/);
    const imageBytes = await response.body(); assert.ok(imageBytes.length > 65536, 'Large room images must exercise chunked Durable Object storage.');
    await host.reload(); await visible(host, 'screenRoomLobby');
    assert.equal(await host.locator('#sharedImagePreview').getAttribute('src'), imageUrl);
    assert.equal(await host.locator('#generationQuality').inputValue(), 'economy');
    await host.locator('#startGameButton').click(); await visible(host, 'creatorControls');
    const firstTask = await host.locator('#secretTask').innerText();
    await createVideo(host, 'Make the subject spin around.');
    assert.match(await guest.locator('#votingTask').innerText(), new RegExp(firstTask.replace('Dein geheimer Auftrag: ', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(await guest.locator('.vote-buttons').isVisible(), false);
    await rate(guest, 5, 3, 'The subject turns around'); await guest.reload(); await visible(guest, 'screenVoting');
    assert.equal(await guest.locator('#votingActionBox').isVisible(), false, 'Submitted guesses and ratings survive reload.');
    await rate(third, 2, 4, 'The camera moves'); await visible(host, 'guessReview');
    assert.equal(await guest.locator('#guessReview').isVisible(), false);
    await host.reload(); await visible(host, 'guessReview');
    assert.equal(await host.locator('#guessReviewList li').count(), 2);
    await host.getByRole('checkbox', { name: 'Treffer von VariantGuest', exact: true }).check();
    await host.screenshot({ path: artifactPath('slopurself-variants-review-desktop.png'), fullPage: true });
    await host.locator('#confirmGuesses').click(); await Promise.all(pages.map(page => visible(page, 'screenResult')));
    assert.match(await host.locator('#resultPointsSummary').innerText(), /7 Punkte/);
    assert.match(await guest.locator('#roundReveal').innerText(), /Make the subject spin around/);
    assert.match(await guest.locator('#roundReveal').innerText(), /\+2 Ratepunkte/);
    await host.locator('#nextRoundButton').click(); await visible(guest, 'creatorControls');
    assert.equal(await guest.locator('#roomNotice').isVisible(), false, 'A previous host-wait notice must not survive the next turn.');
    assert.notEqual(await guest.locator('#secretTask').innerText(), firstTask);
    await guest.screenshot({ path: artifactPath('slopurself-variants-create-mobile.png'), fullPage: true });
    await createVideo(guest, 'Make the subject wave.');
    await rate(host, 3, 3); await rate(third, 3, 3);
    await visible(host, 'screenResult');
    assert.equal(await host.locator('#guessReview').isVisible(), false, 'Skipped guesses do not require a judging phase.');
    await host.locator('#nextRoundButton').click(); await createVideo(third, 'Make the subject dance.');
    await rate(host, 3, 3); await rate(guest, 3, 3);
    await Promise.all(pages.map(page => visible(page, 'screenGameOver')));
    assert.match(await host.locator('#winnerName').innerText(), /VariantGuest.*8 Punkten/);
    assert.match(await host.locator('#finalScoreList').innerText(), /7 Pkt/);
    assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await guest.screenshot({ path: artifactPath('slopurself-variants-final-mobile.png'), fullPage: true });
    for (const page of pages) { await page.locator('#leaveRoomButton').click(); await visible(page, 'screenLobby'); }
    assert.notEqual((await host.request.get(`${base}${imageUrl}`)).status(), 200, 'Room images must stop being accessible after everyone leaves.');
    assert.deepEqual(errors, []);
    console.log('PASS: combined shared-image/secret-task/free-text-guess game, host-only settings, chunked images, reload in lobby/voting/review, bonus scoring, skipped guesses, sequential generation and cleanup; desktop/mobile.');
} catch (error) {
    for (const [index, page] of pages.entries()) await page.screenshot({ path: artifactPath(`slopurself-variants-failed-${index}.png`), fullPage: true });
    throw error;
} finally { await browser.close(); }
