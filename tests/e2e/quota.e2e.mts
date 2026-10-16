import assert from 'node:assert/strict';
import { artifactPath } from '../support/artifacts';
import { spawn } from 'node:child_process';
import { chromium, webkit } from 'playwright';

const port = process.env.TEST_QUOTA_PORT || '3315';
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'tests/support/quota-server.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: port, DATABASE_URL: '', AI_PROVIDER: 'wan22', AI_PROVIDER_CHAIN: 'wan22,wan22-fast', AI_IMAGE_PROFILE: 'bounded', AI_GPU_SECONDS_PER_ROUND: '0', HF_TOKEN: 'test', AUTH_COOKIE_SECRET: 'quota-test-secret-not-for-production-123456' }, stdio: ['pipe', 'pipe', 'pipe']
});
const exited = new Promise<void>(resolve => server.once('exit', () => resolve()));
const ready = new Promise<void>((resolve, reject) => {
    server.stdout.on('data', data => { if (String(data).includes('Server läuft')) resolve(); });
    server.once('error', reject);
    server.once('exit', code => reject(new Error(`Test server exited: ${code}`)));
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
    await ready;
    browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
    const contexts = await Promise.all([0, 1, 2].map(i => browser!.newContext({ viewport: i ? { width: 375, height: 812 } : { width: 1280, height: 900 } })));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const errors: string[] = [];
    for (const [i, page] of pages.entries()) {
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
        await page.goto(base);
        await page.locator('#authUsername').fill(`QuotaPlayer${i}`);
        await page.locator('#authSubmit').click();
        await page.locator('#screenLobby').waitFor({ state: 'visible' });
    }
    const [host, guest, third] = pages;
    const config = await (await host.request.get(`${base}/api/config?players=2`)).json();
    assert.equal(config.remainingGpuSeconds, 185); assert.equal(config.availableGenerations, 2); assert.equal(config.aiRoundLimit, 1);
    assert.equal(config.gpuSecondsPerVideo, 79); assert.equal(config.sharedQuota, true);
    assert.equal((await host.request.get(`${base}/api/config?players=0`)).status(), 400);
    await host.locator('#createRoomButton').click();
    await host.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    const code = await host.locator('#displayRoomCode').innerText();
    const join = async (page: typeof host) => {
        await page.locator('#roomCodeInput').fill(code);
        await page.locator('#joinRoomButton').click();
        await page.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    };
    await join(guest);
    await host.waitForFunction(() => document.getElementById('roomRoundLimitHint')?.innerText === 'Aktuell maximal 1 Runde.');
    assert.equal(await host.locator('#startGameButton').isDisabled(), false);
    assert.equal(await host.locator('#roomRoundCountInput').inputValue(), '1');
    assert.equal(await host.locator('#roomRoundLimitHint').innerText(), 'Aktuell maximal 1 Runde.');
    await host.locator('#roomRoundCountInput').fill('100');
    await host.locator('#roomRoundCountInput').blur();
    await host.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).value === '1');
    assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await guest.screenshot({ path: artifactPath('slopurself-player-quota-mobile.png'), fullPage: true });
    await join(third);
    await host.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).value === '0');
    assert.equal(await host.locator('#roomRoundLimitHint').innerText(), 'Aktuell maximal 0 Runden.');
    assert.equal(await host.locator('#startGameButton').isDisabled(), true);
    assert.equal(await host.locator('#roomRoundCountInput').isDisabled(), true);
    await third.locator('#leaveRoomButton').click();
    await third.locator('#screenLobby').waitFor({ state: 'visible' });
    await host.waitForFunction(() => !(document.getElementById('startGameButton') as HTMLButtonElement).disabled);
    assert.equal(await host.locator('#roomRoundCountInput').inputValue(), '1');
    server.stdin.write('320\n');
    await host.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).max === '2');
    assert.equal(await guest.locator('#generationQuality').isDisabled(), true);
    await host.locator('#generationQuality').selectOption('quality');
    await host.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).max === '1');
    await guest.waitForFunction(() => (document.getElementById('generationQuality') as HTMLSelectElement).value === 'quality');
    await host.locator('#generationQuality').selectOption('economy');
    await host.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).max === '2');
    await host.locator('#generationQuality').selectOption('auto');
    await guest.waitForFunction(() => (document.getElementById('generationQuality') as HTMLSelectElement).value === 'auto');
    server.stdin.write('480\n');
    await join(third);
    await host.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).max === '2');
    await host.locator('#roomRoundCountInput').fill('2');
    await host.locator('#roomRoundCountInput').blur();
    await guest.waitForFunction(() => (document.getElementById('roomRoundCountInput') as HTMLInputElement).value === '2');
    await host.locator('#startGameButton').click();
    await Promise.all(pages.map(page => page.locator('#screenCreate').waitFor({ state: 'visible' })));
    const reserved = await (await host.request.get(`${base}/api/config`)).json();
    assert.equal(reserved.reservedRounds, 6); assert.equal(reserved.availableGenerations, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: live quota uses calibrated 79-second economy / 126-second quality costs, membership, shared reservations and host-only changes; no real AI or production database calls.');
} finally {
    await browser?.close();
    server.kill('SIGTERM');
    await exited;
}
