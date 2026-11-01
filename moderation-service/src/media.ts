import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Decision } from './policy.js';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
export const MAX_MEDIA_EDGE = 1024;
export function checkAbort(signal?: AbortSignal) { signal?.throwIfAborted(); }
export async function inspectVideo(video: string, inspect: (frame: Uint8Array, signal?: AbortSignal) => Promise<Decision>, signal?: AbortSignal,
    inspectBatch?: (frames: Uint8Array[], signal?: AbortSignal) => Promise<Decision>, batchLimits = { frames: 8, bytes: 8 * 1024 * 1024 }) {
    if(!Number.isSafeInteger(batchLimits.frames)||batchLimits.frames<1||batchLimits.frames>64
        ||!Number.isSafeInteger(batchLimits.bytes)||batchLimits.bytes<1024||batchLimits.bytes>8*1024*1024) throw new Error('Invalid bounded batch limits');
    checkAbort(signal);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(video) || video.length % 4 || video.length > 20 * 1024 * 1024) throw new Error('Invalid video');
    const directory = await mkdtemp(join(tmpdir(), 'slop-moderation-'));
    try {
        const path = join(directory, 'input.mp4'); await writeFile(path, Buffer.from(video, 'base64'), { mode: 0o600 });
        const probe = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-count_frames',
            '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,nb_read_frames:format=duration', '-of', 'json', path], { signal, timeout: 10_000, maxBuffer: 65536 });
        if (probe.stderr.trim()) throw new Error('Damaged video');
        const info = JSON.parse(probe.stdout) as { streams?: { codec_type: string; codec_name: string; pix_fmt: string; width: number; height: number; nb_read_frames: string }[]; format?: { duration: string } };
        const stream = info.streams?.[0], duration = Number(info.format?.duration), frames = Number(stream?.nb_read_frames);
        // I2V currently produces silent video. Never publish unreviewed audio,
        // subtitles, attachment pictures or alternative hidden video tracks.
        if (info.streams?.length !== 1 || !stream || stream.codec_type !== 'video' || !Number.isFinite(duration) || duration < 5 || duration > 9
            || !Number.isInteger(frames) || frames < 1 || frames > 240 || stream.codec_name !== 'h264' || stream.pix_fmt !== 'yuv420p'
            || !Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height) || stream.width < 1 || stream.height < 1
            || stream.width > MAX_MEDIA_EDGE || stream.height > MAX_MEDIA_EDGE || stream.width * stream.height > 832 * 832) throw new Error('Unsupported decoded video');
        checkAbort(signal);
        await execute('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-max_alloc', '33554432', '-i', path,
            '-map', '0:v:0', '-fps_mode', 'passthrough', '-frames:v', '241', join(directory, 'frame-%04d.png')], { signal, timeout: 15_000, maxBuffer: 65536 });
        const files = (await readdir(directory)).filter(f => /^frame-\d{4}\.png$/.test(f)).sort();
        if (files.length !== frames) throw new Error('Incomplete video decode');
        let decision: Decision = 'allow';
        // Only byte-identical, fully decoded native frames within this request
        // share a result. No perceptual similarity, resizing or cross-user cache.
        const checked = new Map<string, Decision>();
        if (inspectBatch) {
            // Full native decoded frames, never temporal sampling or thumbnails.
            // Bound resident frame batches and outbound concurrency separately.
            const pending: { bytes: Uint8Array; digest: string }[] = [];
            const seen = new Set<string>();
            const running = new Set<Promise<void>>();
            let failure: unknown, failed = false;
            let pendingBytes=0;
            const flush = () => {
                const batch = pending.splice(0, batchLimits.frames);pendingBytes=0;
                const task = (async () => {
                    const result = await inspectBatch(batch.map(item=>item.bytes), signal);
                    checkAbort(signal);
                    if (!['allow','review','block'].includes(result)) throw new Error('Incomplete batch assessment');
                    for (const item of batch) checked.set(item.digest,result);
                })().catch(error=>{ failed=true;failure=error; });
                running.add(task); void task.then(()=>running.delete(task));
            };
            try {
                for (const file of files) {
                    checkAbort(signal); if(failed) throw failure;
                    const bytes=await readFile(join(directory,file)),digest=createHash('sha256').update(bytes).digest('hex');
                    if(seen.has(digest)) continue;
                    if(bytes.length>batchLimits.bytes) throw new Error('Decoded frame exceeds batch budget');
                    if(pendingBytes+bytes.length>batchLimits.bytes){flush();if(running.size>=2)await Promise.race(running);}
                    seen.add(digest);pending.push({bytes,digest});pendingBytes+=bytes.length;
                    if(pending.length===batchLimits.frames) {flush();if(running.size>=2) await Promise.race(running);}
                }
                if(pending.length) flush();
            } finally { await Promise.all(running); }
            if(failed) throw failure;
            if(checked.size!==seen.size) throw new Error('Incomplete batch frame coverage');
            for(const result of checked.values()) {if(result==='block') decision='block';else if(result==='review'&&decision!=='block') decision='review';}
            checkAbort(signal);
            return { decision, decodeComplete:true,durationSeconds:duration,codec:stream.codec_name,pixelFormat:stream.pix_fmt,
                frameCount:frames,framesChecked:files.length,uniqueFramesChecked:checked.size,assessmentMode:'all-native-frames-in-batches' };
        }
        for (const file of files) {
            checkAbort(signal);
            const bytes = await readFile(join(directory, file));
            const digest = createHash('sha256').update(bytes).digest('hex');
            let result = checked.get(digest);
            if (!result) {
                result = await inspect(bytes, signal); checkAbort(signal);
                if (!['allow', 'review', 'block'].includes(result)) throw new Error('Incomplete frame assessment');
                checked.set(digest, result);
            }
            if (!['allow', 'review', 'block'].includes(result)) throw new Error('Incomplete frame assessment');
            if (result === 'block') decision = 'block'; else if (result === 'review' && decision !== 'block') decision = 'review';
        }
        checkAbort(signal);
        return { decision, decodeComplete: true, durationSeconds: duration, codec: stream.codec_name, pixelFormat: stream.pix_fmt,
            frameCount: frames, framesChecked: files.length, uniqueFramesChecked: checked.size };
    } finally { await rm(directory, { recursive: true, force: true }); }
}
