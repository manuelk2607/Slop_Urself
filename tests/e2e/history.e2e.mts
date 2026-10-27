import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { artifactPath } from '../support/artifacts';

const base = process.argv[2] || 'http://127.0.0.1:3310';
const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const videos = Array.from({ length: 15 }, (_, index) => ({ id: String(200 - index), creatorId: index % 2 ? 'b' : 'a',
    creatorName: index % 2 ? 'Jörg' : 'Änne', roomCode: 'PAGE', roundNumber: index + 1, prompt: 'Eine Person winkt.',
    videoUrl: '/assets/mock-video.mp4', createdAt: '2026-10-14T12:00:00.123456Z', roundPoints: 5,
    evictedAt: index === 0 ? '2026-10-14T13:00:00Z' : null }));
const rooms = Array.from({ length: 53 }, (_, index) => ({ code: `R${String(index).padStart(3, '0')}`, status: 'GAME_OVER',
    winnerName: 'Änne', totalPoints: 5, playerCount: 2, videoCount: 1, createdAt: '2026-10-14T12:00:00Z' }));
let failMore = true, releaseOldPage: (() => void) | undefined;
let aggregateReads = 0;
try {
    await page.route('**/api/stats**', async route => {
        const url = new URL(route.request().url()), creator = url.searchParams.get('player');
        const matching = videos.filter(video => !creator || video.creatorId === creator);
        if (url.pathname === '/api/stats/videos') {
            if (!url.searchParams.get('cursor')) { await route.fulfill({ json: { items: matching.slice(0, 12), nextCursor: matching.length > 12 ? 'video-page-2' : null } }); return; }
            if (failMore) { failMore = false; await route.fulfill({ status: 503, json: { error: 'Historie vorübergehend nicht erreichbar.' } }); return; }
            if (url.searchParams.get('cursor') === 'slow-page') await new Promise<void>(resolve => { releaseOldPage = resolve; });
            await route.fulfill({ json: { items: matching.slice(12), nextCursor: null } }); return;
        }
        if (url.pathname === '/api/stats/rooms') { await route.fulfill({ json: { items: rooms.slice(50), nextCursor: null } }); return; }
        aggregateReads++;
        await route.fulfill({ json: { databaseEnabled: true, videoStorageMode: 'archive',
            overview: { gamesPlayed: 53, completedGames: 53, roundsPlayed: 15, votesCast: 15, videosArchived: 14, highestScore: 5 },
            players: [], videoCreators: [{ id: 'a', name: 'Änne' }, { id: 'b', name: 'Jörg' }], recentVideos: matching.slice(0, 12), rooms: rooms.slice(0, 50),
            videoCursor: matching.length > 12 ? (releaseOldPage === undefined && !failMore ? 'slow-page' : 'video-page-2') : null, roomCursor: 'room-page-2' } });
    });
    await page.goto(base); await page.locator('#statsButton').click();
    await page.locator('#videoStatsList .video-stat-item').nth(11).waitFor();
    assert.equal(await page.locator('#roomStatsList .room-stat-item').count(), 50);
    assert.equal(await page.locator('#videoStatsList .video-unavailable').count(), 1);
    assert.doesNotMatch(await page.locator('#screenStats').innerText(), /undefined/);
    assert.equal(await page.locator('#videoStatsList .video-stat-item').first().locator('video, a').count(), 0);
    await page.locator('#editVideosButton').click();
    await page.locator('.video-selection input').nth(1).check();
    const firstClip = await page.locator('#videoStatsList video').first().elementHandle();
    await firstClip!.evaluate((video: HTMLVideoElement) => video.load());
    await page.waitForFunction(() => (document.querySelector('#videoStatsList video') as HTMLVideoElement).readyState >= 2);
    await page.locator('#moreVideosButton').click();
    await page.locator('#statsActionNotice').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#videoStatsList .video-stat-item').count(), 12);
    assert.equal(await page.locator('#moreVideosButton').isEnabled(), true);
    await page.locator('#moreVideosButton').click();
    await page.locator('#videoStatsList .video-stat-item').nth(14).waitFor();
    assert.equal(await firstClip!.evaluate(video => video.isConnected), true, 'Loading another page must not replace or restart existing videos.');
    assert.equal(await page.locator('.video-selection input').nth(1).isChecked(), true);
    assert.equal(await page.locator('.video-selection input').nth(14).isChecked(), false);
    assert.equal(await page.locator('#moreVideosButton').isVisible(), false);
    await page.locator('.video-selection input').nth(14).check();
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '2 ausgewählt');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.video-download').first().click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^slopurself-PAGE-2\.mp4$/);
    const bytes = await readFile((await download.path())!);
    assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
    await page.locator('#editRoomsButton').click();
    await page.locator('.room-selection input').first().check();
    const firstRoom = await page.locator('#roomStatsList .room-stat-item').first().elementHandle();
    await page.locator('#moreRoomsButton').click();
    await page.locator('#roomStatsList .room-stat-item').nth(52).waitFor();
    assert.equal(await firstRoom!.evaluate(room => room.isConnected), true);
    await page.locator('.room-selection input').last().check();
    assert.equal(await page.locator('#roomSelectionCount').innerText(), '2 ausgewählt');
    assert.equal(await page.locator('#moreRoomsButton').isVisible(), false);
    await page.screenshot({ path: artifactPath('slopurself-history-desktop.png'), fullPage: true });
    await page.locator('#videoPlayerFilter').scrollIntoViewIfNeeded();
    await page.screenshot({ path: artifactPath('slopurself-history-desktop-detail.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: artifactPath('slopurself-history-mobile.png'), fullPage: true });
    await page.locator('#videoStatsList .video-stat-item').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: artifactPath('slopurself-history-mobile-detail.png') });
    await page.locator('#backToLobbyButton').click(); await page.locator('#statsButton').click();
    await page.locator('#moreVideosButton').waitFor({ state: 'visible' });
    await page.locator('#moreVideosButton').click();
    await page.waitForFunction(() => document.getElementById('moreVideosButton')?.textContent?.includes('Wird geladen'));
    const readsBeforeFilter = aggregateReads;
    await page.locator('#videoPlayerFilter').selectOption('b');
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 7);
    assert.ok(releaseOldPage); releaseOldPage();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#videoStatsList .video-stat-item').count(), 7, 'A stale page must not append videos after a creator filter change.');
    assert.doesNotMatch(await page.locator('#videoStatsList').innerText(), /Änne/);
    assert.equal(aggregateReads, readsBeforeFilter, 'Changing a video filter must not load aggregate statistics or reconcile the archive again.');
    assert.deepEqual(errors, []);
    console.log('PASS: paginated history retains playback/selection, retries failed pages, ignores stale pages, displays evicted videos and downloads MP4 on desktop/mobile.');
} catch (error) {
    await page.screenshot({ path: artifactPath('slopurself-history-failed.png'), fullPage: true }); throw error;
} finally { releaseOldPage?.(); await browser.close(); }
