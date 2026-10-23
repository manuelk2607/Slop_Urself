import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit, type Page } from 'playwright';
import { testImage } from '../support/images';
import { artifactPath } from '../support/artifacts';

const directory = await mkdtemp(join(tmpdir(), 'slop-hf-e2e-'));
const base = 'http://127.0.0.1:3326';
const server = spawn(process.execPath, ['--import', 'tsx', 'tests/support/hf-server.ts'], {
    env: { ...process.env, PORT: '3326', DATABASE_URL: '', AUTH_MODE: '', AI_PROVIDER: 'wan22', AI_PROVIDER_CHAIN: 'wan22,wan22-fast',
        AI_IMAGE_PROFILE: 'bounded', AI_GPU_SECONDS_PER_ROUND: '0', HF_TOKEN: 'central', HF_OAUTH_CLIENT_ID: 'isolated-test-client', HF_OAUTH_ORIGIN: '',
        HF_OAUTH_ENCRYPTION_KEY: '', HF_LOCAL_STORAGE_DIR: directory, AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
        AWS_ENDPOINT_URL_S3: 'https://storage.test', AUTH_COOKIE_SECRET: 'isolated-hf-test-signing-key-at-least-32-characters' },
    stdio: ['ignore', 'pipe', 'pipe']
});
const exit = new Promise(resolve => server.once('exit', resolve));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('HF test server startup timeout')), 15_000);
        server.stdout.on('data', value => { if (String(value).includes('Server läuft')) { clearTimeout(timer); resolve(); } });
        server.once('error', reject); server.once('exit', () => { clearTimeout(timer); reject(new Error('HF test server exited early')); });
    });
    browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH || undefined });
    const contexts = await Promise.all([1280, 375].map(width => browser!.newContext({ viewport: { width, height: 900 } })));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const errors: string[] = [];
    for (const [i, page] of pages.entries()) {
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
        await page.goto(base); await page.locator('#screenAuth').waitFor({ state: 'visible' });
        await page.locator('#authUsername').fill(i ? 'PersonalB' : 'PersonalA'); await page.locator('#authSubmit').click();
        await page.locator('#screenLobby').waitFor({ state: 'visible' });
        assert.equal((await (await page.request.get(`${base}/api/config`)).json()).aiRoundLimit, 0);
        // Bypass the UI gate: the server itself must reject unlinked players.
        const denial = await page.evaluate(() => new Promise<string>((resolve, reject) => {
            const io = (window as unknown as { io: (options: object) => { on: (event: string, listener: (data?: string) => void) => void; emit: (event: string, payload: object) => void; disconnect: () => void } }).io;
            const connection = io({ forceNew: true });
            const timer = setTimeout(() => { connection.disconnect(); reject(new Error('Missing HF server-side rejection')); }, 5000);
            connection.on('connect', () => connection.emit('createRoom', {}));
            connection.on('hfRequired', data => { clearTimeout(timer); connection.disconnect(); resolve(data || ''); });
        }));
        assert.match(denial, /Hugging-Face-Konto/);
        await page.locator('#createRoomButton').click();
        await page.locator('#hfDialog').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#screenRoomLobby').isVisible(), false);
        await page.locator('#hfCloseButton').click();
        await page.locator('#hfAccountButton').click();
        await page.locator('#hfConnectButton').click();
        await page.locator('#hfDevice').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#hfDeviceCode').innerText(), i ? 'EFGH-5678' : 'ABCD-1234');
        const pending = await (await page.request.get(`${base}/api/hf/device`)).json();
        assert.equal(pending.pending, true);
        assert.equal('deviceCode' in pending, false);
        if (i === 1) {
            await page.reload(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
            await page.locator('#hfAccountButton').click(); await page.locator('#hfDevice').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#hfDeviceCode').innerText(), 'EFGH-5678');
        }
        // Only HF approval is simulated; device polling, vault, cookie and UI reload use real app code.
        await page.waitForEvent('load');
        await page.locator('#screenLobby').waitFor({ state: 'visible' });
        await page.locator('#hfDialog').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.getElementById('hfStatus')?.textContent?.includes('300 / 300'));
        await page.locator('#hfCloseButton').click();
    }
    const [host, guest] = pages;
    await host.locator('#createRoomButton').click(); await host.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    await guest.locator('#roomCodeInput').fill(await host.locator('#displayRoomCode').innerText());
    await guest.locator('#joinRoomButton').click(); await guest.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    await host.waitForFunction(() => document.getElementById('roomRoundLimitHint')?.textContent?.includes('3 Runden'));
    await host.locator('#roomRoundCountInput').fill('3'); await host.locator('#roomRoundCountInput').dispatchEvent('change');
    await guest.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).value === '3');
    await host.locator('#startGameButton').click();
    const png = testImage(320, 240);
    const upload = async (page: Page) => {
        await page.locator('#creatorControls').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#hfAccountButton').isDisabled(), true);
        await page.locator('#imageInput').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
        await page.locator('#imagePreview').waitFor({ state: 'visible' });
        await page.locator('#promptInput').fill('The subject waves.'); await page.locator('#uploadButton').click();
        await Promise.all(pages.map(p => p.locator('#screenVoting').waitFor({ state: 'visible' })));
        await Promise.all(pages.map(p => p.waitForFunction(() => {
            const video = document.getElementById('votingVideoPlayer') as HTMLVideoElement;
            return video.readyState >= 2 && video.duration >= 5 && video.currentTime > 0.3 && !video.error;
        })));
    };
    for (let round = 1; round <= 3; round++) {
        await upload(host);
        if (round === 1) { await host.reload(); await host.locator('#screenVoting').waitFor({ state: 'visible' }); }
        await guest.locator('[data-points="4"]').click(); await host.locator('#screenResult').waitFor({ state: 'visible' });
        await host.locator('#nextRoundButton').click(); await upload(guest); await host.locator('[data-points="3"]').click();
        if (round < 3) { await host.locator('#screenResult').waitFor({ state: 'visible' }); await host.locator('#nextRoundButton').click(); }
    }
    await Promise.all(pages.map(p => p.locator('#screenGameOver').waitFor({ state: 'visible' })));
    assert.match(await host.locator('#winnerName').innerText(), /PersonalA.*12 Punkten/);
    assert.equal(await guest.locator('#winnerName').innerText(), await host.locator('#winnerName').innerText());
    assert.deepEqual(await guest.locator('#finalScoreList li').allTextContents(), await host.locator('#finalScoreList li').allTextContents());
    for (const page of pages) {
        const status = await (await page.request.get(`${base}/api/hf`)).json();
        assert.equal(status.remainingSeconds, 90);
        assert.equal('token' in status, false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(errors, []);
    await guest.screenshot({ path: artifactPath('slopurself-personal-hf-game.png'), fullPage: true });
    console.log('PASS: two separate OAuth sessions, three rounds/six videos using creator-specific tokens, reload, voting and identical final scores; no real GPU usage.');
} finally {
    await browser?.close(); server.kill('SIGTERM'); await exit;
    await rm(directory, { recursive: true, force: true });
}
