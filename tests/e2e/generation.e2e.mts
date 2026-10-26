import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit } from 'playwright';
import { testImage } from '../support/images';
const state = await mkdtemp(join(tmpdir(), 'slop-generation-ui-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'tests/support/generation-server.ts'], {
    env: { ...process.env, PORT: '3327', AI_PROVIDER: 'mock', AUTH_MODE: 'disabled', DATABASE_URL: '', HF_TOKEN: '', TEST_PROFILE_DB: 'false',
        HF_LOCAL_STORAGE_DIR: join(state, 'hf'), MODERATION_LOCAL_STORAGE_DIR: join(state, 'moderation'), ARCHIVE_RESERVATIONS_LOCAL_STORAGE_DIR: join(state, 'archive') },
    stdio: ['ignore', 'pipe', 'inherit']
});
const exit = new Promise(resolve => server.once('exit', resolve));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Status fixture startup timeout')), 15_000);
        server.stdout.on('data', data => { if (String(data).includes('Server läuft')) { clearTimeout(timeout); resolve(); } });
        server.once('error', reject); server.once('exit', () => { clearTimeout(timeout); reject(new Error('Status fixture stopped')); });
    });
    browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH || undefined });
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
    await page.goto('http://127.0.0.1:3327'); await page.locator('#usernameInput').fill('StatusTest'); await page.locator('#createRoomButton').click();
    await page.locator('#screenRoomLobby').waitFor({ state: 'visible' }); await page.locator('#startGameButton').click();
    await page.locator('#creatorControls').waitFor({ state: 'visible' });
    await page.locator('#imageInput').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: testImage(320, 240) });
    await page.locator('#imagePreview').waitFor({ state: 'visible' });
    await page.locator('#promptInput').fill('The cube rotates.'); await page.locator('#uploadButton').click();
    await page.waitForFunction(() => document.getElementById('loadingText')?.textContent?.includes('GPU-Platz'));
    await page.waitForFunction(() => document.getElementById('loadingElapsed')?.textContent?.includes('0:01'));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('loadingText')?.textContent?.includes('GPU-Platz'));
    assert.doesNotMatch(await page.locator('#loadingElapsed').innerText(), /0:00/);
    await page.waitForFunction(() => document.getElementById('loadingText')?.textContent?.includes('berechnet'));
    assert.equal(await page.locator('#loadingElapsed').getAttribute('aria-live'), 'off');
    await page.locator('#screenVoting').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#loadingElapsed').innerText(), '');
    assert.deepEqual(errors, []);
    console.log('PASS: queue/inference stages and elapsed time survive reload; no repeated mock submission or noisy live clock.');
} finally { await browser?.close(); server.kill('SIGTERM'); await exit; await rm(state, { recursive: true, force: true }); }
