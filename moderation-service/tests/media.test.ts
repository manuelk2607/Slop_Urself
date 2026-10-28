import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectVideo } from '../src/media.js';
import sharp from 'sharp';
const execute = promisify(execFile);
test('real safe videos decode every frame, propagate block/review, reject hidden audio and honor cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slop-safe-media-test-'));
    const path = join(directory, 'safe.mp4'), audioPath = join(directory, 'audio.mp4');
    try {
        await execute('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=1:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path]);
        const video = (await readFile(path)).toString('base64'); let calls = 0;
        const value = await inspectVideo(video, async frame => {
            const metadata = await sharp(frame).metadata();
            assert.equal(metadata.width, 640); assert.equal(metadata.height, 360, 'Moderation must not discard source pixels before classification.');
            calls++; return calls === 3 ? 'review' : 'allow';
        });
        assert.equal(value.framesChecked, 5); assert.equal(value.frameCount, 5); assert.equal(value.decision, 'review'); assert.equal(calls, 5);
        assert.equal(value.uniqueFramesChecked, 5);
        calls = 0;
        const blocked = await inspectVideo(video, async () => { calls++; return calls === 2 ? 'block' : 'allow'; });
        assert.equal(blocked.decision, 'block'); assert.equal(calls, 5);
        await execute('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '5', '-c:v', 'copy', '-c:a', 'aac', audioPath]);
        calls = 0; await assert.rejects(inspectVideo((await readFile(audioPath)).toString('base64'), async () => { calls++; return 'allow'; }), /Unsupported/); assert.equal(calls, 0);
        const abort = new AbortController(); calls = 0;
        await assert.rejects(inspectVideo(video, async () => { calls++; abort.abort(); return 'allow'; }, abort.signal)); assert.equal(calls, 1);
        await assert.rejects(inspectVideo(Buffer.from('not a video').toString('base64'), async () => 'allow'));
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('only exact repeated decoded frames reuse a verdict, scoped to one complete inspection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slop-repeat-frame-test-'));
    try {
        const path = join(directory, 'repeat.mp4');
        await execute('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=640x360:r=1:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path]);
        const video = (await readFile(path)).toString('base64');
        for (const decision of ['allow', 'review', 'block'] as const) {
            let calls = 0;
            const result = await inspectVideo(video, async () => { calls++; return decision; });
            assert.equal(calls, 1); assert.equal(result.uniqueFramesChecked, 1);
            assert.equal(result.framesChecked, 5); assert.equal(result.frameCount, 5); assert.equal(result.decision, decision);
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
});
