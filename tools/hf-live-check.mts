import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkLiveEvidence, lockLiveEvidence, saveLiveEvidence, type LiveEvidence } from './support/hf-live-evidence.mts';

const args = process.argv.slice(2), expected = args.find(arg => arg.startsWith('--hf-user='))?.slice(10);
if (!args.includes('--execute-one-free-video') || !expected || !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,40}$/.test(expected)) throw new Error('Explizit starten: node --import tsx tools/hf-live-check.mts --execute-one-free-video --hf-user=DEIN-HF-NAME');
const evidencePath = resolve('.local/hf-live-evidence.json');
// These guards run before importing Playwright or contacting any server.
await checkLiveEvidence(evidencePath);
const unlock = await lockLiveEvidence(evidencePath);
await checkLiveEvidence(evidencePath);
const origin = 'https://slopurself.maki26.workers.dev';
const evidence: LiveEvidence = { version: 1, expectedUsername: expected, origin, profile: `HF_${randomUUID().slice(0, 10)}`, stage: 'preflight' };
let browser: import('playwright').Browser | undefined, context: import('playwright').BrowserContext | undefined;
let ownProfile = false;
try {
    await saveLiveEvidence(evidencePath, evidence);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: false }); context = await browser.newContext();
    const page = await context.newPage();
    const configResponse = await context.request.get(`${origin}/api/config`);
    assert.equal(configResponse.status(), 200);
    const config = await configResponse.json(); assert.equal(config.mockAi, false); assert.equal(config.videoDuration, 5); assert.equal(config.authEnabled, true);
    await page.goto(origin); await page.locator('#authUsername').fill(evidence.profile);
    // Protect the isolated test profile without saving its random password in the evidence.
    await page.locator('#authPasswordSection summary').click(); await page.locator('#authPassword').fill(randomUUID());
    await page.locator('#authSubmit').click(); await page.locator('#screenLobby').waitFor({ state: 'visible' });
    ownProfile = true;
    evidence.stage = 'personal-device-consent'; await saveLiveEvidence(evidencePath, evidence);
    await page.locator('#hfAccountButton').click(); await page.locator('#hfConnectButton').click();
    await page.locator('#hfDevice').waitFor({ state: 'visible' });
    console.log('Bitte im geöffneten Spielfenster die persönliche HF-Gerätefreigabe bestätigen. Keine Tokens hier eingeben.');
    const quota = async () => {
        const response = await context!.request.get(`${origin}/api/hf`); assert.equal(response.status(), 200);
        const data = await response.json();
        assert.equal(data.connected, true); assert.equal(data.username?.toLowerCase(), expected.toLowerCase());
        assert.ok(Number.isFinite(data.remainingSeconds) && Number.isFinite(data.totalSeconds));
        return { username: data.username as string, remaining: data.remainingSeconds as number, total: data.totalSeconds as number };
    };
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
        const response = await context.request.get(`${origin}/api/hf`), status = await response.json();
        if (status.connected) { evidence.before = await quota(); break; }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    assert.ok(evidence.before, 'Keine persönliche Freigabe beobachtet.');
    await page.goto(origin); await page.locator('#createRoomButton').click(); await page.locator('#screenRoomLobby').waitFor({ state: 'visible' });
    evidence.roomCode = await page.locator('#displayRoomCode').innerText();
    await page.locator('#generationQuality').selectOption('economy');
    await page.waitForFunction(() => !(document.getElementById('startGameButton') as HTMLButtonElement).disabled);
    await page.locator('#startGameButton').click(); await page.locator('#creatorControls').waitFor({ state: 'visible' });
    const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640;
        const c = canvas.getContext('2d')!; c.fillStyle = '#72bde5'; c.fillRect(0, 0, 640, 640);
        c.fillStyle = '#14864b'; c.fillRect(0, 440, 640, 200); c.fillStyle = '#e23b46'; c.fillRect(220, 240, 160, 160);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#imageInput').setInputFiles({ name: 'synthetic-square.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
    await page.locator('#promptInput').fill('The red cube slowly rotates in place. Static camera.');
    evidence.before = await quota(); evidence.stage = 'submission-uncertain'; evidence.submittedAt = new Date().toISOString();
    // Persist the one-shot fence before the first click, even if the click or connection fails.
    await saveLiveEvidence(evidencePath, evidence);
    await page.locator('#uploadButton').click();
    await page.locator('#screenVoting').waitFor({ state: 'visible', timeout: 900_000 });
    const video = page.locator('#votingVideoPlayer');
    evidence.videoPath = await video.getAttribute('src') || undefined;
    assert.match(evidence.videoPath!, /^\/api\/videos\/videos\/\d{13}-[a-z0-9-]+\.mp4$/);
    await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
    await page.waitForFunction(() => (document.getElementById('votingVideoPlayer') as HTMLVideoElement).currentTime > 0.3);
    evidence.duration = await video.evaluate((element: HTMLVideoElement) => element.duration); assert.ok(evidence.duration! >= 5);
    evidence.playbackVerified = true;
    const range = await context.request.get(`${origin}${evidence.videoPath}`, { headers: { Range: 'bytes=0-63' } });
    assert.equal(range.status(), 206); assert.match(range.headers()['content-range'], /^bytes 0-63\//);
    assert.equal((await range.body()).subarray(4, 8).toString(), 'ftyp'); evidence.rangeVerified = true;
    await page.locator('#finishPreviewButton').click(); await page.locator('#screenGameOver').waitFor({ state: 'visible' });
    let archived = false;
    for (let i = 0; i < 12; i++) {
        const response = await context.request.get(`${origin}/api/stats`); const stats = await response.json();
        if (stats.recentVideos?.some((v: { videoUrl: string }) => v.videoUrl === evidence.videoPath)) { archived = true; break; }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    assert.ok(archived);
    evidence.after = await quota(); assert.equal(evidence.after.username, evidence.before.username); assert.equal(evidence.after.total, evidence.before.total);
    evidence.debit = evidence.before.remaining - evidence.after.remaining;
    assert.ok(evidence.debit > 0, 'Keine tatsächliche persönliche Kontingentabbuchung beobachtet.');
    evidence.success = true; evidence.stage = 'complete';
    console.log(`Nachweis erfolgreich: ein archiviertes Video, ${evidence.debit} persönliche GPU-Sekunden abgebucht.`);
} catch {
    evidence.success = false; console.error(`Nachweis nicht vollständig. Prüfphase: ${evidence.stage}. Kein automatischer Neuversuch.`); process.exitCode = 1;
} finally {
    // A fresh, isolated context can only remove this tool's own test connection.
    if (ownProfile && context) {
        const result = await context.request.delete(`${origin}/api/hf`, { headers: { origin } }).catch(() => undefined);
        if (!result?.ok()) console.error('Die eigene Testverbindung konnte nicht getrennt werden; sie läuft spätestens nach acht Stunden ab.');
    }
    await saveLiveEvidence(evidencePath, evidence); await browser?.close(); await unlock();
}
