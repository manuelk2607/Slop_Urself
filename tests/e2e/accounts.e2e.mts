import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium, webkit, type Page } from 'playwright';
import { artifactPath } from '../support/artifacts';

const base = 'http://127.0.0.1:3340';
const child = spawn(process.execPath, ['--import', 'tsx', 'tests/support/admin-server.ts'], {
    env: { ...process.env, HF_TOKEN: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit']
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Admin server startup timed out')), 15_000);
        child.stdout.on('data', data => { if (String(data).includes('Server läuft')) { clearTimeout(timer); resolve(); } });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Admin server exited ${code}`)); });
    });
    browser = await (process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
    const owner = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const friend = await browser.newContext();
    const clone = await browser.newContext();
    const errors: string[] = [];
    async function login(page: Page, name: string) {
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base); await page.locator('#authUsername').fill(name);
        await page.locator('#existingNameButton').click(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    }
    const page = await owner.newPage(), friendPage = await friend.newPage(), clonePage = await clone.newPage();
    await login(page, 'Manuel'); await login(friendPage, 'Friend'); await login(clonePage, 'Manuel');
    const victim = '/api/admin/accounts/admin-friend-id';
    const postOptions = { headers: { origin: base }, data: { key: 'ci-private-admin-key-not-used-in-production' } };
    assert.equal((await friend.request.post(`${base}/api/admin/session`, postOptions)).status(), 403);
    assert.equal((await clone.request.delete(`${base}${victim}`, { headers: { origin: base }, data: { confirmation: 'Friend' } })).status(), 403);
    await friendPage.locator('#statsButton').click();
    assert.equal(await friendPage.locator('#accountManagement').isVisible(), false);
    await friendPage.locator('#backToLobbyButton').click();
    await friendPage.locator('#createRoomButton').click(); await friendPage.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    const original = await (await friend.request.get(`${base}/api/session`)).json();
    await page.locator('#statsButton').click(); await page.locator('#adminUnlockForm').waitFor({ state: 'visible' });
    await page.locator('#adminKey').fill('wrong'); await page.locator('#adminUnlockForm button').click();
    await page.locator('#accountManagementNotice').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#adminKey').inputValue(), '');
    await page.locator('#adminKey').fill(postOptions.data.key); await page.locator('#adminUnlockForm button').click();
    await page.locator('#accountManagementList .account-management-item').first().waitFor();
    assert.equal(await page.locator('#accountManagementList .account-management-item').count(), 2);
    const ownerRow = page.locator('#accountManagementList li').filter({ hasText: 'Manuel' });
    assert.equal(await ownerRow.getByRole('button', { name: 'Passwort setzen' }).count(), 1);
    assert.equal(await ownerRow.getByRole('button', { name: 'Benutzer löschen' }).count(), 0);
    await ownerRow.getByRole('button', { name: 'Passwort setzen' }).click();
    await page.locator('#profilePasswordValue').fill('never-submit-this-password');
    assert.equal(await page.locator('#profilePasswordDialog').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth), true);
    await page.screenshot({ path: artifactPath('slopurself-profile-password-mobile.png'), fullPage: true });
    await page.locator('#profilePasswordCancel').click();
    assert.equal(await page.locator('#profilePasswordValue').inputValue(), '');
    const oldRoom = await friendPage.locator('#displayRoomCode').innerText();
    await page.locator('#accountManagementList li').filter({ hasText: 'Friend' }).getByRole('button', { name: 'Passwort setzen' }).click();
    await page.locator('#profilePasswordConfirmation').fill('Friend');
    await page.locator('#profilePasswordValue').fill('friend-new-password');
    await page.locator('#profilePasswordForm button[type=submit]').click();
    await page.locator('#profilePasswordDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#profilePasswordValue').inputValue(), '');
    assert.equal((await friend.request.get(`${base}/api/session`)).status(), 401);
    // Another player's arrival triggers a snapshot. The revoked, idle socket must not receive it.
    await clonePage.locator('#roomCodeInput').fill(oldRoom); await clonePage.locator('#joinRoomButton').click();
    await friendPage.locator('#screenAuth').waitFor({ state: 'visible' });
    await friendPage.locator('#existingNameButton').click(); await friendPage.locator('#authPassword').waitFor({ state: 'visible' });
    await friendPage.locator('#authPassword').fill('friend-new-password'); await friendPage.locator('#existingNameButton').click();
    await friendPage.locator('#screenLobby').waitFor({ state: 'visible' });
    await friendPage.locator('#createRoomButton').click(); await friendPage.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    let confirm = false, dialogs = 0;
    page.on('dialog', dialog => { dialogs++; assert.match(dialog.message(), /Benutzer „Friend“.*wirklich.*löschen/); void (confirm ? dialog.accept() : dialog.dismiss()); });
    await page.getByRole('button', { name: 'Benutzer löschen', exact: true }).click();
    assert.equal(dialogs, 1); assert.equal((await friend.request.get(`${base}/api/session`)).status(), 200);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: artifactPath('slopurself-admin-management-mobile.png'), fullPage: true });
    confirm = true;
    await page.getByRole('button', { name: 'Benutzer löschen', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#accountManagementList li').length === 1);
    assert.equal(dialogs, 2);
    assert.equal((await friend.request.get(`${base}/api/session`)).status(), 401);
    assert.equal((await friend.request.get(`${base}/api/stats`)).status(), 401);
    assert.equal((await friend.request.post(`${base}/api/session`, { headers: { origin: base }, data: { mode: 'refresh' } })).status(), 401);
    await friendPage.locator('#startGameButton').click();
    await friendPage.locator('#screenAuth').waitFor({ state: 'visible' });
    assert.equal(await friendPage.locator('#gameHeader').isVisible(), false);
    const replacement = await friend.request.post(`${base}/api/session`, { headers: { origin: base }, data: { mode: 'create', username: 'Friend' } });
    assert.equal(replacement.status(), 200); assert.notEqual((await replacement.json()).account.id, original.account.id);
    await page.locator('#lockAccountsButton').click(); await page.locator('#adminUnlockForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#accountManagementList li').count(), 0);
    assert.equal((await owner.request.delete(`${base}${victim}`, { headers: { origin: base }, data: { confirmation: 'Friend' } })).status(), 403);
    assert.deepEqual(errors, []);
    console.log('PASS: owner-only private-key unlock, normal/impersonated profiles denied, confirmation cancel/delete, protected owner, revoked HTTP/WebSocket sessions and reused names; only in-memory fixture accounts changed.');
} finally {
    await browser?.close();
    if (child.exitCode === null) await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
}
