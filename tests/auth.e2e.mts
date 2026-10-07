import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { chromium, webkit } from 'playwright';
import { artifactPath } from './artifacts';
dotenv.config({ path: '.env.local', quiet: true });
const base = process.argv[2] || 'http://127.0.0.1:3312';
const browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await context.newPage();
const username = `audit_${randomUUID().slice(0, 8)}`;
let profileId: string | undefined;
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
    await page.goto(base); await page.locator('#screenAuth').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#authForm input').count(), 1);
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal((await context.request.get(`${base}/api/session`)).status(), 401);
    await page.locator('#authUsername').fill(username);
    const created = page.waitForResponse(response => response.url().endsWith('/api/session') && response.request().method() === 'POST');
    await page.locator('#authSubmit').click();
    const result = await (await created).json(); profileId = result.account?.id;
    assert.ok(profileId);
    await page.locator('#screenLobby').waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await page.locator('#usernameInput').isVisible(), false, 'The lobby must not ask for a second name.');
    await page.reload(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#accountName').innerText(), username);

    const second = await browser.newContext();
    try {
        const another = await second.newPage();
        await another.goto(base); await another.locator('#screenAuth').waitFor({ state: 'visible' });
        await another.locator('#authUsername').fill(username.toUpperCase());
        await another.locator('#authSubmit').click();
        await another.waitForFunction(() => document.getElementById('authError')?.innerText.includes('bereits vergeben'));
        assert.equal(await another.locator('#screenAuth').isVisible(), true);
        await another.locator('#existingNameButton').click();
        await another.locator('#screenLobby').waitFor({ state: 'visible' });
        assert.equal((await (await second.request.get(`${base}/api/session`)).json()).account.id, profileId);
    } finally { await second.close(); }

    if (process.env.TEST_PROFILE_DB !== 'true') {
        await page.locator('#createRoomButton').click(); await page.locator('#screenRoomLobby').waitFor({ state: 'visible' });
        await page.reload(); await page.locator('#screenRoomLobby').waitFor({ state: 'visible' });
        await page.locator('#leaveRoomButton').click(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    }
    await page.locator('#signOutButton').click(); await page.locator('#screenAuth').waitFor({ state: 'visible' });
    assert.equal((await context.request.get(`${base}/api/session`)).status(), 401);
    await page.locator('#existingNameButton').click(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    assert.equal((await (await context.request.get(`${base}/api/session`)).json()).account.id, profileId);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.locator('#signOutButton').click(); await page.locator('#screenAuth').waitFor({ state: 'visible' });
    await page.screenshot({ path: artifactPath('slopurself-username-mobile.png'), fullPage: true });
    console.log('PASS: one username field, duplicate rejection, case-insensitive profile reuse, reload, sign-out, mobile layout and stable statistics ID.');
} catch (error) {
    console.error(await page.locator('#authError').innerText()); await page.screenshot({ path: artifactPath('slopurself-auth-failed.png'), fullPage: true }); throw error;
} finally {
    // The opt-in DB run removes only its exact newly created profile, never game history.
    if (profileId && process.env.TEST_PROFILE_DB === 'true') {
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
        await client.connect();
        try { await client.query('DELETE FROM user_profiles WHERE id = $1 AND name = $2', [profileId, username]); }
        finally { await client.end(); }
    }
    await browser.close();
}
