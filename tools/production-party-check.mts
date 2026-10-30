import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page, type BrowserContext } from 'playwright';

// Explicitly opt-in: creates two isolated production test profiles. The first
// authenticated signup session may bind HF; later access requires that HF owner.
// No inference, imports, fixture bypass, token export, tracing or record deletion.
const origin = 'https://slopurself.maki26.workers.dev';
if (!process.argv.includes('--create-two-test-profiles')) throw new Error('Explicit --create-two-test-profiles required.');
const run = randomUUID(), reportPath = resolve('.local', `production-party-${run}.json`);
await mkdir(resolve('.local'), { recursive: true, mode: 0o700 });
const report: Record<string, unknown> = { run, origin, startedAt: new Date().toISOString(), stage: 'preflight',
    generationRelease: false, completeParty: false, billingVerified: false, gpuCalls: 0,
    limitations: ['Lobby-only test while inference is blocked.', 'No generated video, playback, voting or scoring qualification.',
        'Account quota snapshots cannot establish per-job billing.'] };
const checkpoint = async (stage: string) => { report.stage = stage; await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); };
const browser = await chromium.launch({ headless: false });
const contexts: BrowserContext[] = [], pages: Page[] = [];
const latest: Record<string, unknown>[] = [{}, {}];
const visible = (page: Page, id: string) => page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 20_000 });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean> | boolean, timeout = 20_000, interval = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await check()) return; await delay(interval); }
    throw new Error('Production test condition not met.');
}
const members = (i: number) => latest[i].players as { id: string; name: string; connected: boolean; score: number; ready?: boolean }[] | undefined;
const send = (page: Page, type: string, payload: object) => page.evaluate(({ type, payload }) =>
    (window as unknown as { slopTestSocket: WebSocket }).slopTestSocket.send(JSON.stringify({ type, payload })), { type, payload });
const subjects = new Set<string>();
let errors = 0;
try {
    const preflight = await fetch(`${origin}/api/config`, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    assert.equal(preflight.status, 200);
    const config = await preflight.json() as Record<string, unknown>;
    assert.equal(config.mockAi, false); assert.equal(config.authEnabled, true);
    assert.equal(config.generationBlocked, true); assert.equal(config.aiRoundLimit, 0);
    const release = await fetch(`${origin}/api/release`, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    assert.equal(release.status, 200); report.release = (await release.json() as { release: string }).release;
    for (const i of [0, 1]) {
        const context = await browser.newContext({ viewport: { width: i ? 375 : 1280, height: 850 }, acceptDownloads: false });
        contexts.push(context);
        // Instrument only these isolated test pages; do not change the application
        // or intercept any server result. Native cookie/auth handling is intact.
        await context.addInitScript(() => {
            const Original = window.WebSocket;
            window.WebSocket = class extends Original {
                constructor(url: string | URL, protocols?: string | string[]) {
                    super(url, protocols);
                    if (new URL(String(url), location.href).pathname.startsWith('/ws/'))
                        (window as unknown as { slopTestSocket: WebSocket }).slopTestSocket = this;
                }
            };
        });
        const page = await context.newPage(); pages.push(page);
        page.on('pageerror', () => errors++);
        page.on('response', response => {
            if (response.url() === `${origin}/api/session` && response.request().method() === 'POST') {
                (report.sessionPostStatuses as number[] | undefined) ??= [];
                (report.sessionPostStatuses as number[]).push(response.status());
            }
        });
        page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
            try { const data = JSON.parse(String(payload)); if (data.type === 'roomDataUpdate') latest[i] = data.payload; } catch { /* Non-game frames ignored. */ }
        }));
        await checkpoint(`profile-${i ? 'B' : 'A'}-navigation`);
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20_000 }); await visible(page, 'screenAuth');
        const name = `Rel${i ? 'B' : 'A'}_${run.slice(0, 8)}`;
        assert.ok(name.length <= 15);
        await checkpoint(`profile-${i ? 'B' : 'A'}-registration`);
        await page.locator('#authUsername').fill(name);
        await page.locator('#authSubmit').click(); await visible(page, 'screenLobby');
        (report.testProfiles as string[] | undefined) ??= []; (report.testProfiles as string[]).push(name);
        await checkpoint('profiles-created-awaiting-hf');
        // signedIn may already open the account dialog. Keep one deliberate
        // connection request per profile, then let the human authorize at HF.
        if (!await page.locator('#hfConnectButton').isVisible()) await page.locator('#hfAccountButton').click();
        await page.locator('#hfConnectButton').click(); await visible(page, 'hfDevice');
    }
    console.info('Zwei Produktions-Testfenster bereit. In jedem Fenster die HF-Freigabe selbst bestätigen; für B zum zweiten HF-Konto wechseln. Keine Zugangsdaten im Chat. Keine Videoaufträge.');
    const quota = async (i: number) => {
        const response = await contexts[i].request.get(`${origin}/api/hf`);
        if ([429, 503].includes(response.status())) {
            report.lastHfStatus = response.status(); return { connected: false };
        }
        assert.equal(response.status(), 200); return response.json() as Promise<Record<string, unknown>>;
    };
    const before: object[] = [];
    const consentDeadline = Date.now() + 45 * 60_000;
    for (const i of [0, 1]) {
        await checkpoint(`awaiting-hf-${i ? 'B' : 'A'}`);
        await until(async () => (await quota(i)).connected === true, Math.max(1, consentDeadline - Date.now()), 5000);
        const data = await quota(i);
        assert.equal(typeof data.username, 'string');
        const measurable = Number.isFinite(data.remainingSeconds) && Number.isFinite(data.totalSeconds);
        assert.ok(measurable || data.quotaUnavailable === true, 'Do not invent missing budget values.');
        const subject = createHash('sha256').update(`${run}:${String(data.username).toLowerCase()}`).digest('hex');
        assert.ok(!subjects.has(subject), 'Two distinct HF accounts required.'); subjects.add(subject);
        before.push({ slot: i ? 'B' : 'A', pseudonym: subject, remaining: measurable ? data.remainingSeconds : null,
            total: measurable ? data.totalSeconds : null, quotaUnavailable: !measurable, observedAt: new Date().toISOString() });
        // A completed flow reloads the page and may reopen the dialog. Retain
        // native cookies, but drop the callback query before room actions.
        await pages[i].goto(origin, { waitUntil: 'domcontentloaded' }); await visible(pages[i], 'screenLobby');
    }
    report.before = before; report.distinctHfUsernames = true; await checkpoint('lobby');
    const [host, guest] = pages;
    await host.locator('#createRoomButton').click(); await visible(host, 'screenRoomLobby');
    const code = (await host.locator('#displayRoomCode').innerText()).trim();
    assert.match(code, /^[A-Z0-9]{4}$/); report.roomCode = code;
    await guest.locator('#roomCodeInput').fill(code); await guest.locator('#joinRoomButton').click(); await visible(guest, 'screenRoomLobby');
    await until(() => members(0)?.length === 2 && members(1)?.length === 2);
    report.serverAcceptedDistinctHfRoster = true;
    assert.equal(await guest.locator('#startGameButton').isVisible(), false);
    await guest.reload(); await visible(guest, 'screenRoomLobby');
    await until(() => members(0)?.length === 2 && members(1)?.length === 2);
    await contexts[1].setOffline(true);
    await guest.evaluate(() => window.dispatchEvent(new Event('offline')));
    await until(() => members(0)?.some(p => !p.connected) === true);
    await contexts[1].setOffline(false); await until(() => members(0)?.every(p => p.connected) === true);
    const names = report.testProfiles as string[];
    const options = (i: number) => latest[i].options as { sharedImage?: boolean } | undefined;
    await send(host, 'setGameOptions', { roomId: code, options: { sharedImage: true } });
    await until(() => options(0)?.sharedImage === true && options(1)?.sharedImage === true);
    const imageBase64 = await host.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640;
        const c = canvas.getContext('2d')!; c.fillStyle = '#68b8e4'; c.fillRect(0, 0, 640, 640);
        c.fillStyle = '#e93b46'; c.fillRect(220, 220, 160, 160);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await send(host, 'setSharedImage', { roomId: code, imageBase64 });
    // The following allowed command is an ordering fence on the same socket:
    // its snapshot proves the preceding rejected action has been processed.
    await send(host, 'setReady', { roomId: code, ready: true });
    await until(() => members(1)?.find(p => p.name === names[0])?.ready === true);
    for (const value of latest) { assert.ok(!value.sharedImageUrl); assert.ok(!value.sharedImagePending); }
    report.blockedServerUploadVerified = true;
    await send(host, 'setGameOptions', { roomId: code, options: { sharedImage: false } });
    await until(() => options(0)?.sharedImage === false && options(1)?.sharedImage === false);
    await send(guest, 'setGameOptions', { roomId: code, options: { sharedImage: true } });
    await send(guest, 'setReady', { roomId: code, ready: true });
    await until(() => members(0)?.find(p => p.name === names[1])?.ready === true);
    assert.equal(options(0)?.sharedImage, false); assert.equal(options(1)?.sharedImage, false);
    report.hostOnlyOptionsVerified = true;
    assert.equal(await host.locator('#startGameButton').isDisabled(), true);
    await send(host, 'startGame', { roomId: code });
    await delay(1500); assert.equal(latest[0].gameState, 'LOBBY'); assert.equal(latest[1].gameState, 'LOBBY');
    assert.ok(members(0)?.every(p => p.score === 0));
    report.lobbySync = true; report.reloadRestored = true; report.disconnectRestored = true; report.blockedStartRemainedInLobby = true;
    for (const page of pages) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    report.mobileFits = true; assert.equal(errors, 0); report.javascriptErrors = errors;
    report.after = await Promise.all([0, 1].map(async i => { const q = await quota(i); return { slot: i ? 'B' : 'A', remaining: q.remainingSeconds, total: q.totalSeconds, observedAt: new Date().toISOString() }; }));
    await guest.locator('#leaveRoomButton').click(); await visible(guest, 'screenLobby'); await until(() => members(0)?.length === 1);
    await host.locator('#leaveRoomButton').click(); await visible(host, 'screenLobby');
    report.lobbyChecksPassed = true; await checkpoint('lobby-checks-complete');
} catch (error) {
    report.failureType = error instanceof Error && ['TimeoutError', 'AssertionError', 'TypeError'].includes(error.name) ? error.name : 'TestError';
    report.failedAt = report.stage; report.lobbyChecksPassed = false; await checkpoint('incomplete'); process.exitCode = 1;
    console.error('Produktionsprüfung nicht vollständig. Keine Wiederholung und keine KI-Freigabe. Siehe privaten Ergebnisbericht.');
} finally {
    report.connectionCleanup = await Promise.all(contexts.map(async context => {
        try { return (await context.request.delete(`${origin}/api/hf`, { headers: { origin } })).ok(); } catch { return false; }
    }));
    // Only disconnect this tool's own grants. No profiles/rooms/videos deleted.
    await browser.close(); report.completedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.info(`Privater Bericht: .local/production-party-${run}.json; echte KI und Abrechnung weiterhin nicht freigegeben.`);
}
