import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { buildVideoPrompt, VIDEO_NEGATIVE_PROMPT } from '../../src/shared/video-prompt';
const base = process.argv[2] || 'http://127.0.0.1:3310';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH || undefined });
try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('#usernameInput').fill('PromptPreview');
    await page.locator('#createRoomButton').click(); await page.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    await page.locator('#startGameButton').click(); await page.locator('#creatorControls').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#promptPreview').isVisible(), false);
    const prompt = '<img src=x onerror=alert(1)> Transform the paper bird into a butterfly.';
    await page.locator('#promptInput').fill(prompt);
    const summary = page.locator('#promptPreview summary'); await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#effectivePrompt').innerText(), buildVideoPrompt(prompt));
    assert.equal(await page.locator('#effectivePrompt img').count(), 0);
    assert.ok((await page.locator('#promptPreview').innerText()).includes(VIDEO_NEGATIVE_PROMPT));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.reload(); await page.locator('#creatorControls').waitFor({ state: 'visible' });
    await page.locator('#promptPreview summary').click();
    assert.equal(await page.locator('#effectivePrompt').innerText(), buildVideoPrompt(prompt));
    await page.locator('#promptInput').fill(''); assert.equal(await page.locator('#promptPreview').isVisible(), false);
    await page.locator('#leaveRoomButton').click(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    console.log('PASS: exact shared effective prompt, literal markup, keyboard details, mobile width and restored preview; no GPU calls.');
} finally { await browser.close(); }
