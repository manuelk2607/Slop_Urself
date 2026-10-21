import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:3310';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
try {
    const page = await browser.newPage(); let calls = 0, failed = false, release!: () => void;
    const allStarted = new Promise<void>(resolve => { release = resolve; });
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('undo-test-seeded')) {
            sessionStorage.setItem('undo-test-seeded', 'yes');
            sessionStorage.setItem('slopurself-video-undo', JSON.stringify(Array.from({ length: 451 }, (_, i) => ({ url: `/api/stats/videos/${i + 1}`, undoUntil: Date.now() + 30_000 }))));
        }
    });
    await page.route('**/api/stats/videos/restore', async route => {
        const ids: string[] = route.request().postDataJSON().ids; assert.ok(ids.length <= 200); calls++;
        if (calls === 3) release();
        await allStarted; // A serial client cannot reach the third request.
        if (ids.includes('201') && !failed) { failed = true; await route.fulfill({ status: 503, json: { error: 'Bitte erneut versuchen.' } }); return; }
        await route.fulfill({ json: { results: ids.map(id => ({ id, status: id === '451' ? 'expired' : 'restored' })) } });
    });
    await page.goto(base); await page.locator('#statsButton').click();
    await page.reload(); await page.locator('#statsButton').click();
    await page.locator('#undoVideoDeletion').click();
    await page.waitForFunction(() => document.getElementById('videoUndoLabel')!.textContent!.startsWith('200 Videos') && !(document.getElementById('undoVideoDeletion') as HTMLButtonElement).disabled);
    assert.equal(calls, 3);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('slopurself-video-undo')!).length), 200);
    await page.locator('#undoVideoDeletion').click(); await page.locator('#videoUndoNotice').waitFor({ state: 'hidden' });
    assert.equal(calls, 4);
    console.log('PASS: 451 undo entries survive reload; three <=200-ID batches launch concurrently; partial expiry and temporary failure remain retryable.');
} finally { await browser.close(); }
