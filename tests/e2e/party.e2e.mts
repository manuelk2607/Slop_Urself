import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium, webkit, type Page } from 'playwright';
import { artifactPath } from '../support/artifacts';

const server = spawn(process.execPath, ['--import', 'tsx', 'tests/support/party-server.ts'], { env: { ...process.env,
    PORT: '3317', DATABASE_URL: '', AUTH_MODE: 'disabled', HF_TOKEN: 'test', AI_PROVIDER: 'wan22',
    AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
const exited = new Promise<void>(resolve => server.once('exit', () => resolve()));
const ready = new Promise<void>((resolve, reject) => {
    server.stdout.on('data', data => { if (String(data).includes('Server läuft')) resolve(); });
    server.once('error', reject); server.once('exit', code => reject(new Error(`Party server exited: ${code}`)));
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const visible = (page: Page, id: string) => page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 15000 });
try {
    await ready;
    browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
    const host = await (await browser.newContext()).newPage(), guest = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
    const pages = [host, guest], errors: string[] = [];
    for (const [i, page] of pages.entries()) {
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:3317'); await page.locator('#authUsername').fill(`Replay${i}`);
        await page.locator('#authSubmit').click(); await visible(page, 'screenLobby');
    }
    for (const mode of ['archive-vote', 'archive-guess']) {
        await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
        assert.equal(await host.locator('#startGameButton').isDisabled(), true, 'Live play is blocked at zero quota, not room creation.');
        const code = await host.locator('#displayRoomCode').innerText();
        await guest.goto(`http://127.0.0.1:3317/?room=${code}`); await visible(guest, 'screenLobby');
        assert.equal(await guest.locator('#roomCodeInput').inputValue(), code);
        await guest.locator('#joinRoomButton').click(); await visible(guest, 'screenRoomLobby');
        await host.locator('#gameMode').selectOption(mode); await host.locator('#phaseSeconds').selectOption('60');
        await host.waitForFunction(() => !(document.getElementById('startGameButton') as HTMLButtonElement).disabled);
        assert.equal(await guest.locator('#gameMode').isDisabled(), true);
        await host.reload(); await visible(host, 'screenRoomLobby'); assert.equal(await host.locator('#gameMode').inputValue(), mode);
        await host.locator('#startGameButton').click(); await Promise.all(pages.map(p => visible(p, 'screenVoting')));
        for (let turn = 0; turn < 2; turn++) {
            const judge = pages[turn], voter = pages[1 - turn];
            await voter.locator('#votingVideoPlayer').evaluate(async (video: HTMLVideoElement) => { await video.play(); });
            await voter.waitForFunction(() => (document.getElementById('votingVideoPlayer') as HTMLVideoElement).currentTime > 0);
            assert.match(await host.locator('#phaseCountdown').innerText(), /Noch \d+ s/);
            if (mode === 'archive-guess') await voter.locator('#guessInput').fill('A plausible action');
            await voter.locator('[data-points="4"]').click();
            if (mode === 'archive-vote') await judge.locator('[data-points="5"]').click();
            else {
                await visible(judge, 'guessReview'); await judge.locator('#guessReviewList input').check(); await judge.locator('#confirmGuesses').click();
            }
            await Promise.all(pages.map(p => visible(p, turn ? 'screenGameOver' : 'screenResult')));
            if (!turn) { await host.locator('#nextRoundButton').click(); await Promise.all(pages.map(p => visible(p, 'screenVoting'))); }
        }
        assert.equal(await host.locator('#archiveRanking li').count(), 2);
        if (mode === 'archive-vote') assert.equal(await host.locator('#finalScoreList').isVisible(), false);
        else assert.match(await host.locator('#winnerName').innerText(), /2 Punkten/);
        assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await guest.screenshot({ path: artifactPath(`slopurself-${mode}-mobile.png`), fullPage: true });
        for (const page of pages) { await page.locator('#leaveRoomButton').click(); await visible(page, 'screenLobby'); }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: both archive modes with zero GPU quota, independent scores, every-voter best-of, rotating guessing judge, invitations, playback, reload and mobile layout.');
} finally { await browser?.close(); server.kill('SIGTERM'); await exited; }
