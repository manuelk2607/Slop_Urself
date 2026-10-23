import assert from 'node:assert/strict';
import { artifactPath } from '../support/artifacts';
import { testImage } from '../support/images';
import { spawn } from 'node:child_process';
import { chromium, webkit, Page } from 'playwright';
import { connectTestHf } from '../support/hf-browser';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const external = process.argv[2];
const port = '3316';
const base = external || `http://127.0.0.1:${port}`;
const directory = await mkdtemp(join(tmpdir(), 'slop-extension-e2e-'));
const server = external ? undefined : spawn(process.execPath, ['--import', 'tsx', 'tests/support/quota-server.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: port, DATABASE_URL: '', AI_PROVIDER: 'wan22',
        AI_PROVIDER_CHAIN: 'wan22,wan22-fast', AI_IMAGE_PROFILE: 'bounded', AI_GPU_SECONDS_PER_ROUND: '0', HF_TOKEN: 'test',
        HF_OAUTH_CLIENT_ID: 'test-public-client', HF_OAUTH_ORIGIN: '', HF_LOCAL_STORAGE_DIR: directory,
        AWS_ACCESS_KEY_ID: 'test-only', AWS_SECRET_ACCESS_KEY: 'test-only', AWS_ENDPOINT_URL_S3: 'https://storage.test',
        TEST_EXTRA_ROUNDS: 'true', AUTH_COOKIE_SECRET: 'extra-round-test-secret-at-least-32-characters' }, stdio: ['pipe', 'pipe', 'pipe']
});
const exited = server && new Promise<void>(resolve => server.once('exit', () => resolve()));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
    if (server) await new Promise<void>((resolve, reject) => {
        server.stdout.on('data', data => { if (String(data).includes('Server läuft')) resolve(); });
        server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    });
    browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
    const contexts = await Promise.all([false, true].map(mobile => browser!.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 } })));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const [host, guest] = pages;
    const errors: string[] = [];
    const config = await (await host.request.get(`${base}/api/config`)).json();
    for (const [i, page] of pages.entries()) {
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
        await page.goto(base);
        if (config.authEnabled) {
            await page.locator('#authUsername').fill(i ? 'ExtraGuest' : 'ExtraHost');
            await page.locator('#authSubmit').click();
        } else await page.locator('#usernameInput').fill(i ? 'ExtraGuest' : 'ExtraHost');
        await page.locator('#screenLobby').waitFor({ state: 'visible' });
        if (config.hfRequired) await connectTestHf(page, base);
    }
    const png = testImage(320, 240);
    const upload = async (page: Page) => {
        await page.locator('#imageInput').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
        await page.locator('#imagePreview').waitFor({ state: 'visible' });
        await page.locator('#promptInput').fill('The subject waves.');
        await page.locator('#uploadButton').click();
        await Promise.all(pages.map(p => p.locator('#screenVoting').waitFor({ state: 'visible' })));
    };
    await host.locator('#createRoomButton').click();
    await host.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    assert.equal(await host.locator('#roomRoundCountInput').inputValue(), '1');
    const code = await host.locator('#displayRoomCode').innerText();
    await guest.locator('#roomCodeInput').fill(code); await guest.locator('#joinRoomButton').click();
    await guest.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    await host.locator('#startGameButton').click();
    for (let cycle = 1; cycle <= 4; cycle++) {
        await host.locator('#creatorControls').waitFor({ state: 'visible' });
        assert.equal(await host.locator('#roundCounter').innerText(), `${cycle}/${cycle}`);
        await upload(host); await guest.locator('[data-points="4"]').click();
        await host.locator('#screenResult').waitFor({ state: 'visible' });
        await host.locator('#nextRoundButton').click();
        await guest.locator('#creatorControls').waitFor({ state: 'visible' });
        await upload(guest); await host.locator('[data-points="3"]').click();
        await Promise.all(pages.map(p => p.locator('#screenGameOver').waitFor({ state: 'visible' })));
        assert.match(await host.locator('#winnerName').innerText(), new RegExp(`ExtraHost.*${cycle * 4} Punkten`));
        assert.equal(await guest.locator('#extendGameButton').isVisible(), false);
        assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await guest.locator('#roomNotice').isVisible(), false);
        await host.waitForFunction(() => document.getElementById('extensionQuotaHint')?.innerText.startsWith('Noch maximal'));
        assert.match(await host.locator('#extensionQuotaHint').innerText(), /^Noch maximal \d+ Zusatzrunden?\.$/);
        if (cycle === 1) {
            await host.reload(); await host.locator('#screenGameOver').waitFor({ state: 'visible' });
            await host.waitForFunction(() => !(document.getElementById('extendGameButton') as HTMLButtonElement).disabled);
            await guest.screenshot({ path: artifactPath('slopurself-extension-mobile.png'), fullPage: true });
            await host.screenshot({ path: artifactPath('slopurself-extension-desktop.png'), fullPage: true });
            await host.setViewportSize({ width: 375, height: 812 });
            assert.equal(await host.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            const extension = await host.locator('#extendGameButton').boundingBox();
            const restart = await host.locator('#restartButton').boundingBox();
            assert.ok(extension && restart && extension.y + extension.height < restart.y);
            await host.screenshot({ path: artifactPath('slopurself-extension-host-mobile.png'), fullPage: true });
            await host.setViewportSize({ width: 1280, height: 900 });
        }
        if (cycle < 4) {
            await host.waitForFunction(() => !(document.getElementById('extendGameButton') as HTMLButtonElement).disabled);
            await host.locator('#extendGameButton').click();
            await Promise.all(pages.map(p => p.locator('#screenCreate').waitFor({ state: 'visible' })));
            assert.equal(await host.locator('#displayRoomCode').innerText(), code);
        }
    }
    if (!external) {
        await host.waitForFunction(() => (document.getElementById('extendGameButton') as HTMLButtonElement).disabled);
        assert.equal(await host.locator('#extensionQuotaHint').innerText(), 'Noch maximal 0 Zusatzrunden.');
        const quota = await (await host.request.get(`${base}/api/config`)).json();
        assert.equal(quota.reservedRounds, 0); assert.equal(quota.aiRoundLimit, 0);
    }
    await guest.reload(); await guest.locator('#screenGameOver').waitFor({ state: 'visible' });
    assert.match(await guest.locator('#finalScoreList').innerText(), /12 Pkt/);
    assert.deepEqual(errors, []);
    console.log('PASS: two players create eight videos over four cycles with simulated cheaper consumption; host-only extra rounds, cumulative scores, same room, reload, call quota exhaustion and mobile layout. No real AI or production DB calls.');
} catch (error) {
    for (const [i, page] of (browser?.contexts().flatMap(c => c.pages()) || []).entries()) await page.screenshot({ path: artifactPath(`slopurself-extension-failed-${i}.png`), fullPage: true });
    throw error;
} finally {
    await browser?.close(); server?.kill('SIGTERM'); if (exited) await exited;
    await rm(directory, { recursive: true, force: true });
}
