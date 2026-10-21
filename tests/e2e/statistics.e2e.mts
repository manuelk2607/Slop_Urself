import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { artifactPath } from '../support/artifacts';

const base = process.argv[2] || 'http://127.0.0.1:3310';
const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [], deletes: string[] = [], confirmations: string[] = [];
let timeOffset = 0;
const now = () => Date.now() + timeOffset;
let accept = false;
let holdSecondDelete = false, releaseDelete: (() => void) | undefined;
let deleteHeld!: () => void;
const secondDeleteHeld = new Promise<void>(resolve => { deleteHeld = resolve; });
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => {
    if (dialog.type() !== 'confirm') errors.push(dialog.message());
    confirmations.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
});
let players = [{ id: 'account-a', name: 'Änne', totalScore: 5 }, { id: 'account-b', name: 'Jörg', totalScore: 3 }];
const videos = [{ id: '101', creatorId: 'account-a', creatorName: 'Änne', roomCode: 'R001', roundNumber: 1, roomDeleted: false, deletedUntil: 0 },
    { id: '102', creatorId: 'account-b', creatorName: 'Jörg', roomCode: 'R002', roundNumber: 1, roomDeleted: false, deletedUntil: 0 },
    { id: '103', creatorId: 'account-b', creatorName: 'Jörg', roomCode: 'LIVE', roundNumber: 1, roomDeleted: false, deletedUntil: 0 }];
let rooms = [{ code: 'R001', status: 'GAME_OVER', winnerName: 'Änne', totalPoints: 5 },
    { code: 'R002', status: 'GAME_OVER', winnerName: 'Jörg', totalPoints: 3 }, { code: 'LIVE', status: 'PLAYING', winnerName: null, totalPoints: 0 }];
try {
    await page.clock.install();
    await page.route('**/api/stats**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/stats/videos/restore') {
            const results = route.request().postDataJSON().ids.map((id: string) => {
                const video = videos.find(item => item.id === id);
                if (!video) return { id, status: 'not_found' };
                if (video.deletedUntil && video.deletedUntil <= now()) return { id, status: 'expired' };
                video.deletedUntil = 0; return { id, status: 'restored' };
            });
            await route.fulfill({ json: { results } }); return;
        }
        const videoMatch = /^\/api\/stats\/videos\/(\d+)(\/restore)?$/.exec(url.pathname);
        if (videoMatch) {
            const video = videos.find(video => video.id === videoMatch[1]);
            if (!video) { await route.fulfill({ status: 404, json: { error: 'Video nicht gefunden.' } }); return; }
            if (route.request().method() === 'POST' && videoMatch[2]) {
                if (video.deletedUntil && video.deletedUntil <= now()) { await route.fulfill({ status: 410, json: { error: 'Die Frist zum Rückgängigmachen ist abgelaufen.' } }); return; }
                video.deletedUntil = 0; await route.fulfill({ json: { ok: true } }); return;
            }
            deletes.push(url.pathname);
            if (holdSecondDelete && video.id === '102') await new Promise<void>(resolve => { releaseDelete = resolve; deleteHeld(); });
            if (video.roomCode === 'LIVE' && !video.roomDeleted) { await route.fulfill({ status: 409, json: { error: 'Der Raum wird noch gespielt. Beende die Partie zuerst.' } }); return; }
            video.deletedUntil = now() + 30_000;
            await route.fulfill({ json: { ok: true, undoUntil: video.deletedUntil } }); return;
        }
        if (route.request().method() === 'DELETE') {
            deletes.push(url.pathname);
            if (url.pathname.includes('/LIVE')) { await route.fulfill({ status: 409, json: { error: 'Der Raum wird noch gespielt. Beende die Partie zuerst.' } }); return; }
            const code = url.pathname.split('/')[4];
            rooms = rooms.filter(room => room.code !== code);
            videos.filter(video => video.roomCode === code).forEach(video => { video.roomDeleted = true; });
            if (code === 'R001') players = players.filter(player => player.id !== 'account-a');
            if (code === 'R002') players = players.map(player => player.id === 'account-b' ? { ...player, totalScore: 0 } : player);
            await route.fulfill({ json: { ok: true } }); return;
        }
        const creator = url.searchParams.get('player');
        await route.fulfill({ json: {
            databaseEnabled: true, videoStorageMode: 'archive',
            overview: { gamesPlayed: rooms.length, completedGames: rooms.filter(room => room.status === 'GAME_OVER').length, roundsPlayed: 2, votesCast: 2, videosArchived: videos.filter(video => !video.deletedUntil).length, highestScore: 5 },
            players: players.map(player => ({ ...player, gamesPlayed: 1, wins: 1, roundsCreated: 1, averageReceivedPoints: player.totalScore, averageVoteGiven: 3 })),
            recentVideos: videos.filter(video => !video.deletedUntil && (!creator || video.creatorId === creator)).map(video => ({ ...video, prompt: 'Eine Person winkt.', videoUrl: '/assets/mock-video.mp4', roundPoints: 5, createdAt: '2026-10-13T00:00:00Z' })),
            videoCreators: [...new Map(videos.filter(video => !video.deletedUntil).map(video => [video.creatorId, { id: video.creatorId, name: video.creatorName }])).values()],
            rooms: rooms.map(room => ({ ...room, playerCount: 2, videoCount: videos.filter(video => !video.deletedUntil && video.roomCode === room.code).length, createdAt: '2026-10-13T00:00:00Z' }))
        } });
    });
    await page.goto(base);
    await page.locator('#statsButton').click();
    await page.locator('#videoStatsList .video-stat-item').first().waitFor();
    assert.equal(await page.locator('#videoStatsList .video-stat-item').count(), 3);
    assert.equal(await page.locator('.video-selection').first().isVisible(), false);
    assert.equal(await page.locator('.room-selection').first().isVisible(), false);
    assert.equal(await page.locator('#deleteSelectedRooms').isEnabled(), false);
    const originalPlayer = await page.getByRole('button', { name: 'Änne', exact: true }).elementHandle();
    await page.getByRole('button', { name: 'Änne', exact: true }).focus();
    await page.getByRole('button', { name: 'Änne', exact: true }).press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 1);
    assert.equal(await page.locator('#videoPlayerFilter').inputValue(), 'account-a');
    assert.match(await page.locator('#videoStatsList').innerText(), /Änne/);
    assert.doesNotMatch(await page.locator('#videoStatsList').innerText(), /Jörg/);
    assert.equal(await originalPlayer!.evaluate(button => button.isConnected), true, 'Filtering must not replace the focused player name.');
    assert.equal(await page.getByRole('button', { name: 'Änne', exact: true }).evaluate(button => button === document.activeElement), true);
    await page.locator('#videoPlayerFilter').scrollIntoViewIfNeeded();
    await page.locator('#videoPlayerFilter').focus();
    const before = await page.evaluate(() => ({ y: scrollY, top: document.getElementById('videoPlayerFilter')!.getBoundingClientRect().top }));
    await page.locator('#videoPlayerFilter').selectOption('account-b');
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 2);
    const after = await page.evaluate(() => ({ y: scrollY, top: document.getElementById('videoPlayerFilter')!.getBoundingClientRect().top }));
    assert.ok(Math.abs(before.y - after.y) <= 2 && Math.abs(before.top - after.top) <= 2, `Filter scrolled: ${JSON.stringify({ before, after })}`);
    assert.equal(await page.locator('#videoPlayerFilter').evaluate(select => select === document.activeElement), true);
    await page.locator('#videoPlayerFilter').selectOption('account-a');
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 1);
    await page.locator('#editVideosButton').click();
    await page.locator('#selectAllVideos').check();
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '1 ausgewählt');
    await page.locator('#deleteSelectedVideos').click();
    assert.equal(deletes.length, 0, 'Cancel must not submit a delete request.');
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '1 ausgewählt');
    await page.locator('#videoPlayerFilter').selectOption('');
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 3);
    assert.equal(await page.locator('#selectAllVideos').evaluate(input => (input as HTMLInputElement).indeterminate), true);
    await page.locator('#selectAllVideos').check();
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '3 ausgewählt');
    await page.screenshot({ path: artifactPath('slopurself-statistics-edit-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: artifactPath('slopurself-statistics-edit-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    accept = true;
    holdSecondDelete = true;
    const dialogsBefore = confirmations.length;
    await page.locator('#deleteSelectedVideos').click();
    await secondDeleteHeld;
    await page.waitForFunction(() => document.getElementById('videoUndoLabel')!.textContent!.includes('1 Video gelöscht'));
    assert.equal(await page.locator('#undoVideoDeletion').isEnabled(), true, 'Undo must be offered before a slow batch has finished.');
    assert.equal(await page.locator('#deleteSelectedVideos').isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('videoUndoNotice')!.hidden === false);
    assert.ok(releaseDelete); holdSecondDelete = false; releaseDelete();
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 1 && document.getElementById('statsActionNotice')!.textContent!.includes('2 von 3'));
    assert.equal(confirmations.length, dialogsBefore + 1, 'A batch must have one confirmation, not one per file.');
    assert.equal(deletes.length, 3);
    assert.match(await page.locator('#statsList').innerText(), /5 Pkt/);
    assert.match(confirmations.at(-1)!, /Punkte und Bewertungen bleiben erhalten/);
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '1 ausgewählt', 'Only the failed deletion remains selected.');
    assert.equal(await page.locator('.video-selection input').isChecked(), true);
    await page.locator('#editVideosButton').click();
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '0 ausgewählt');
    assert.equal(await page.locator('#videoEditToolbar').isVisible(), false);
    await page.locator('#videoUndoNotice').waitFor({ state: 'visible' });
    assert.match(await page.locator('#videoUndoLabel').innerText(), /2 Videos gelöscht/);
    await page.reload(); await page.locator('#statsButton').click();
    await page.locator('#undoVideoDeletion').waitFor({ state: 'visible' });
    await page.locator('#statsOverview .stat-card').first().waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const undoBox = (await page.locator('#videoUndoNotice').boundingBox())!;
    assert.ok(undoBox.y >= 0 && undoBox.y + undoBox.height <= 812);
    await page.screenshot({ path: artifactPath('slopurself-video-undo-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#undoVideoDeletion').click();
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 3);
    assert.equal(await page.locator('#videoUndoNotice').isVisible(), false, 'Undo must survive reload and restore the whole batch.');
    await page.locator('#videoPlayerFilter').selectOption('account-a');
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 1);
    await page.locator('#editVideosButton').click(); await page.locator('#selectAllVideos').check();
    await page.locator('#deleteSelectedVideos').click();
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 0);
    timeOffset += 31_000; await page.clock.fastForward(31_000);
    assert.equal(await page.locator('#videoUndoNotice').isVisible(), false);
    assert.equal(await page.evaluate(async () => (await fetch('/api/stats/videos/101/restore', { method: 'POST' })).status), 410);
    await page.locator('#editVideosButton').click();
    await page.locator('#editRoomsButton').click();
    const activeRoom = page.locator('#roomStatsList .room-stat-item').filter({ hasText: 'Raum LIVE' });
    await activeRoom.getByRole('checkbox', { name: 'Raum LIVE auswählen', exact: true }).check();
    assert.equal(await page.locator('#roomSelectionCount').innerText(), '1 ausgewählt');
    accept = false;
    const deletesBeforeCancel = deletes.length;
    await page.locator('#deleteSelectedRooms').click();
    assert.equal(deletes.length, deletesBeforeCancel, 'Cancelling a room batch must not delete any room.');
    assert.match(confirmations.at(-1)!, /Runden, Bewertungen und Spielpunkte/);
    assert.match(confirmations.at(-1)!, /Videos und Benutzerkonten bleiben erhalten/);
    accept = true;
    await page.locator('#deleteSelectedRooms').click();
    await page.waitForFunction(() => document.getElementById('statsActionNotice')!.textContent!.includes('0 von 1 Raum'));
    await page.locator('#statsActionNotice').waitFor({ state: 'visible' });
    assert.match(await page.locator('#statsActionNotice').innerText(), /noch gespielt/);
    assert.equal(await page.locator('#deleteSelectedRooms').isEnabled(), true);
    assert.equal(await activeRoom.getByRole('checkbox').isChecked(), true);
    await page.locator('#editRoomsButton').click();
    assert.equal(await page.locator('#roomSelectionCount').innerText(), '0 ausgewählt');
    assert.equal(await page.locator('#roomEditToolbar').isVisible(), false);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: artifactPath('slopurself-statistics-management-mobile.png'), fullPage: true });
    videos.push({ id: '104', creatorId: 'account-a', creatorName: 'Änne', roomCode: 'R001', roundNumber: 2, roomDeleted: false, deletedUntil: 0 });
    await page.locator('#videoPlayerFilter').selectOption('');
    await page.locator('#videoPlayerFilter').selectOption('account-a');
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 1 && document.getElementById('videoStatsList')!.textContent!.includes('Video 2'));
    await page.locator('#editVideosButton').click();
    await page.locator('#selectAllVideos').check();
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '1 ausgewählt');
    await page.locator('#editRoomsButton').click();
    await page.getByRole('checkbox', { name: 'Raum R001 auswählen', exact: true }).check();
    assert.equal(await page.locator('#selectAllRooms').evaluate(input => (input as HTMLInputElement).indeterminate), true);
    await page.locator('#selectAllRooms').check();
    assert.equal(await page.locator('#roomSelectionCount').innerText(), '3 ausgewählt');
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '1 ausgewählt', 'Room editing must not change the independent video selection.');
    await page.screenshot({ path: artifactPath('slopurself-room-edit-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: artifactPath('slopurself-room-edit-desktop.png'), fullPage: true });
    const roomDialogs = confirmations.length, roomDeletes = deletes.length;
    await page.locator('#deleteSelectedRooms').click();
    await page.waitForFunction(() => document.querySelectorAll('#roomStatsList .room-stat-item').length === 1 && document.getElementById('statsActionNotice')!.textContent!.includes('2 von 3 Räumen'));
    assert.equal(confirmations.length, roomDialogs + 1, 'Multiple rooms require one shared confirmation.');
    assert.deepEqual(deletes.slice(roomDeletes).sort(), ['/api/stats/rooms/LIVE', '/api/stats/rooms/R001', '/api/stats/rooms/R002']);
    assert.equal(await page.locator('#roomSelectionCount').innerText(), '1 ausgewählt', 'The active room remains selected after a partial batch failure.');
    assert.equal(await page.getByRole('checkbox', { name: 'Raum LIVE auswählen', exact: true }).isChecked(), true);
    assert.equal(await page.locator('#videoSelectionCount').innerText(), '1 ausgewählt', 'Room deletion must preserve the independent video selection.');
    assert.doesNotMatch(await page.locator('#statsList').innerText(), /Änne/);
    await page.waitForFunction(() => document.getElementById('videoStatsList')!.textContent!.includes('Gelöschter Raum R001'));
    assert.equal(await page.locator('#videoPlayerFilter').inputValue(), 'account-a', 'Creators without surviving games remain available in the video filter.');
    assert.match(await page.locator('#videoStatsList').innerText(), /Änne.*Gelöschter Raum R001/s);
    await page.locator('#deleteSelectedVideos').click();
    await page.waitForFunction(() => document.querySelectorAll('#videoStatsList .video-stat-item').length === 0);
    await page.locator('#undoVideoDeletion').click();
    await page.waitForFunction(() => document.getElementById('videoStatsList')!.textContent!.includes('Gelöschter Raum R001'));
    assert.equal(await page.locator('#roomStatsList .room-stat-item').count(), 1, 'Undo must not recreate the deleted room.');
    await page.screenshot({ path: artifactPath('slopurself-retained-video-desktop.png'), fullPage: true });
    await page.locator('#backToLobbyButton').click();
    await page.locator('#statsButton').click();
    await page.locator('#roomStatsList .room-stat-item').waitFor();
    assert.equal(await page.locator('#editRoomsButton').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#roomEditToolbar').isVisible(), false);
    assert.equal(await page.locator('#roomSelectionCount').innerText(), '0 ausgewählt');
    assert.deepEqual(errors, []);
    console.log('PASS: stable filters, multi-selection, retained videos/creators after room deletion, reversible batch deletion across reload, undo expiry, protected live rooms and responsive layout; no production data changed.');
} catch (error) {
    await page.screenshot({ path: artifactPath('slopurself-statistics-management-failed.png'), fullPage: true });
    throw error;
} finally { releaseDelete?.(); await browser.close(); }
