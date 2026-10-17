import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { chromium, webkit } from 'playwright';
import { artifactPath } from '../support/artifacts';
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
    assert.equal(await page.locator('#screenAuth h2').innerText(), 'Anmelden oder registrieren');
    assert.equal(await page.locator('#authSubmit').innerText(), 'Neuen Benutzer registrieren');
    assert.equal(await page.locator('#existingNameButton').innerText(), 'Vorhandenen Benutzer anmelden');
    assert.match(await page.locator('#authHint').innerText(), /Neu dabei.*Schon gespielt/);
    assert.equal(await page.locator('#authForm input').count(), 1);
    assert.equal(await page.locator('#screenAuth input[type=password]').count(), 0);
    assert.equal((await context.request.get(`${base}/api/session`)).status(), 401);
    await page.locator('#authUsername').fill(username);
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.locator('#accountName').evaluate(element => element.getBoundingClientRect().height < 50), true, 'A mobile username must not be squeezed between both account buttons.');
    const buttonHeights = await Promise.all(['authSubmit', 'existingNameButton'].map(id => page.locator(`#${id}`).evaluate(button => button.getBoundingClientRect().height)));
    let releaseLogin!: () => void;
    const heldLogin = new Promise<void>(resolve => { releaseLogin = resolve; });
    await page.route('**/api/session', async route => {
        if (route.request().method() === 'POST') await heldLogin;
        await route.continue();
    });
    const unknown = page.waitForResponse(response => response.url().endsWith('/api/session') && response.request().method() === 'POST');
    await page.locator('#existingNameButton').click();
    assert.equal(await page.locator('#existingNameButton').innerText(), 'Anmeldung l\u00e4uft...');
    assert.equal(await page.locator('#authForm').getAttribute('aria-busy'), 'true');
    assert.deepEqual(await Promise.all(['authSubmit', 'existingNameButton'].map(id => page.locator(`#${id}`).evaluate(button => button.getBoundingClientRect().height))), buttonHeights);
    releaseLogin();
    const rejected = await unknown;
    assert.equal(rejected.status(), 404);
    assert.equal(rejected.request().postDataJSON().mode, 'login');
    await page.waitForFunction(() => document.getElementById('authError')?.innerText.includes('Neuen Benutzer registrieren'));
    await page.unroute('**/api/session');
    assert.equal(await page.locator('#authForm').getAttribute('aria-busy'), null);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal((await context.request.get(`${base}/api/session`)).status(), 401, 'Login must not silently register an unknown user.');
    const created = page.waitForResponse(response => response.url().endsWith('/api/session') && response.request().method() === 'POST');
    await page.locator('#authSubmit').click();
    const registration = await created;
    assert.equal(registration.request().postDataJSON().mode, 'create');
    const result = await registration.json(); profileId = result.account?.id;
    assert.ok(profileId);
    await page.locator('#screenLobby').waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await page.locator('#usernameInput').isVisible(), false, 'The lobby must not ask for a second name.');
    await page.reload(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#accountName').innerText(), username);

    await page.locator('#hfAccountButton').click();
    await page.waitForFunction(() => document.getElementById('hfStatus')?.textContent?.includes('noch nicht eingerichtet'));
    assert.equal(await page.locator('#hfConnectButton').isDisabled(), true);
    assert.equal(await page.locator('#hfDisconnectButton').isVisible(), false);
    await page.locator('#hfCloseButton').click();
    await page.route('**/api/hf', async route => {
        if (route.request().method() !== 'GET') { await route.continue(); return; }
        await route.fulfill({ json: { configured: true, connected: true, username: 'HF_Testspieler', remainingSeconds: 300, totalSeconds: 300 } });
    });
    await page.locator('#hfAccountButton').click();
    await page.waitForFunction(() => document.getElementById('hfStatus')?.textContent?.includes('HF_Testspieler'));
    assert.equal(await page.locator('#hfDisconnectButton').isVisible(), true);
    assert.equal(await page.locator('#hfConnectButton').innerText(), 'HF-Verbindung erneuern');
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.locator('#hfDialog').evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth), true);
    assert.equal(await page.locator('#hfDialog').evaluate(element => {
        const box = element.getBoundingClientRect();
        return Math.abs(box.x + box.width / 2 - innerWidth / 2) < 2 && Math.abs(box.y + box.height / 2 - innerHeight / 2) < 2;
    }), true, 'The HF dialog must remain centered on mobile.');
    await page.screenshot({ path: artifactPath('slopurself-hf-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await page.locator('#hfDialog').evaluate(element => {
        const box = element.getBoundingClientRect();
        return Math.abs(box.x + box.width / 2 - innerWidth / 2) < 2 && Math.abs(box.y + box.height / 2 - innerHeight / 2) < 2;
    }), true, 'The HF dialog must remain centered on desktop.');
    await page.screenshot({ path: artifactPath('slopurself-hf-desktop.png'), fullPage: true });
    let oauthRequests = 0;
    await context.route('https://huggingface.co/oauth/authorize**', route => { oauthRequests++; return route.fulfill({ contentType: 'text/html', body: '<title>HF OAuth test</title>' }); });
    await page.route('**/api/hf/connect', route => route.fulfill({ json: { url: 'https://huggingface.co/oauth/authorize?client_id=test&scope=openid%20profile&prompt=consent' } }));
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#hfConnectButton').click();
    const oauthPopup = await popupPromise;
    await oauthPopup.waitForURL(/huggingface\.co\/oauth\/authorize/);
    assert.equal(new URL(oauthPopup.url()).searchParams.get('prompt'), 'consent');
    await new Promise(resolve => setTimeout(resolve, 1_100));
    assert.equal(oauthRequests, 2, 'The OAuth tab retries the same idempotent authorization URL once.');
    await oauthPopup.close();
    await page.unroute('**/api/hf/connect');
    await context.unroute('https://huggingface.co/oauth/authorize**');
    await page.locator('#hfCloseButton').click();
    await page.unroute('**/api/hf');
    await page.setViewportSize({ width: 375, height: 812 });

    const second = await browser.newContext();
    try {
        const another = await second.newPage();
        await another.goto(base); await another.locator('#screenAuth').waitFor({ state: 'visible' });
        await another.locator('#authUsername').fill(username.toUpperCase());
        await another.locator('#authSubmit').click();
        await another.waitForFunction(() => document.getElementById('authError')?.innerText.includes('bereits vergeben'));
        assert.match(await another.locator('#authError').innerText(), /Melde dich mit dem vorhandenen Benutzer an/);
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
    assert.equal(await page.locator('#authSubmit').innerText(), 'Neuen Benutzer registrieren');
    assert.equal(await page.locator('#existingNameButton').innerText(), 'Vorhandenen Benutzer anmelden');
    await page.screenshot({ path: artifactPath('slopurself-username-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const id of ['authSubmit', 'existingNameButton']) assert.equal(await page.locator(`#${id}`).evaluate(button => button.scrollWidth <= button.clientWidth), true);
    await page.screenshot({ path: artifactPath('slopurself-username-small-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: artifactPath('slopurself-username-desktop.png'), fullPage: true });
    console.log('PASS: clearly labeled registration/login, one username field, unknown-user login rejected, duplicate guidance, profile reuse, reload, sign-out, mobile/desktop layout and stable statistics ID.');
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
