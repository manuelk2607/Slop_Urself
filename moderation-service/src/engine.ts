import { AutoProcessor, AutoModelForVision2Seq, RawImage, Tensor, pipeline, env } from '@huggingface/transformers';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decide, POLICY, type Decision, type ModelLock, type Scores } from './policy.js';

const execute = promisify(execFile);
// The non-root container cannot write Transformers.js' node_modules cache.
// Only pinned model weights, never player media, belong in this directory.
env.cacheDir = process.env.MODEL_CACHE_DIR || join(tmpdir(), 'slop-model-cache');
export async function createEngine(lock: ModelLock) {
    const classifier = await pipeline('image-classification', lock.nsfw.id, { revision: lock.nsfw.revision, device: 'cpu', dtype: 'fp32' });
    const processor = await AutoProcessor.from_pretrained(lock.vlm.id, { revision: lock.vlm.revision });
    const model = await AutoModelForVision2Seq.from_pretrained(lock.vlm.id, { revision: lock.vlm.revision, device: 'cpu', dtype: 'fp32' });
    async function inspect(bytes: Uint8Array, prompt: string): Promise<Decision> {
        const image = await sharp(bytes, { limitInputPixels: 832 * 832, failOn: 'error' }).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixels = new RawImage(new Uint8Array(image.data), image.info.width, image.info.height, 3);
        const scores = await classifier(pixels, { top_k: 2 }) as Scores[];
        if (scores.some(s => s.label.toLowerCase() === 'nsfw' && s.score >= 0.8)) return 'block';
        const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: `${POLICY}\nQuoted proposed action: ${JSON.stringify(prompt)}` }] }];
        // The model's multimodal template accepts content blocks; v3's shared
        // Message declaration still describes text-only messages.
        const text = processor.apply_chat_template(messages as unknown as Parameters<typeof processor.apply_chat_template>[0], { add_generation_prompt: true });
        const inputs = await processor(text, pixels);
        const generated = await model.generate({ ...inputs, max_new_tokens: 96, do_sample: false });
        const inputIds = inputs.input_ids;
        if (!(generated instanceof Tensor) || !(inputIds instanceof Tensor) || inputIds.dims.length !== 2) throw new Error('Unexpected model output');
        // Decode only new tokens. JSON in quoted input or the policy template
        // must never be mistaken for the model's classification.
        const output = processor.batch_decode(generated.slice(null, [inputIds.dims[1], generated.dims[1]]), { skip_special_tokens: true })[0];
        return decide(scores, output.trim());
    }
    return {
        input: async (image: string, prompt: string) => {
            const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
            if (!match || match[1].length % 4 || match[1].length > 12 * 1024 * 1024) throw new Error('Invalid normalized input');
            return { decision: await inspect(Buffer.from(match[1], 'base64'), prompt), decodeComplete: true };
        },
        output: async (video: string) => {
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(video) || video.length % 4 || video.length > 20 * 1024 * 1024) throw new Error('Invalid video');
            const directory = await mkdtemp(join(tmpdir(), 'slop-moderation-'));
            try {
                const path = join(directory, 'input.mp4'); await writeFile(path, Buffer.from(video, 'base64'), { mode: 0o600 });
                const probe = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-count_frames',
                    '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_read_frames:format=duration', '-of', 'json', path], { timeout: 10_000, maxBuffer: 65536 });
                const info = JSON.parse(probe.stdout) as { streams?: { codec_name: string; pix_fmt: string; width: number; height: number; nb_read_frames: string }[]; format?: { duration: string } };
                const stream = info.streams?.[0], duration = Number(info.format?.duration), frames = Number(stream?.nb_read_frames);
                if (!stream || !Number.isFinite(duration) || duration < 5 || duration > 9 || !Number.isInteger(frames) || frames < 1 || frames > 240
                    || stream.codec_name !== 'h264' || stream.pix_fmt !== 'yuv420p' || stream.width * stream.height > 1024 * 1024) throw new Error('Unsupported decoded video');
                await execute('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-max_alloc', '33554432', '-i', path,
                    '-map', '0:v:0', '-vf', 'scale=320:-2', '-vsync', '0', '-frames:v', '241', join(directory, 'frame-%04d.png')], { timeout: 15_000, maxBuffer: 65536 });
                const files = (await readdir(directory)).filter(f => /^frame-\d{4}\.png$/.test(f)).sort();
                if (files.length !== frames) throw new Error('Incomplete video decode');
                let decision: Decision = 'allow';
                for (const file of files) {
                    const result = await inspect(await readFile(join(directory, file)), 'Classify the visible video frame, including sexual exploitation, nonconsensual intimate depiction and graphic abuse.');
                    if (result === 'block') decision = 'block'; else if (result === 'review' && decision !== 'block') decision = 'review';
                }
                return { decision, decodeComplete: true, durationSeconds: duration, codec: stream.codec_name, pixelFormat: stream.pix_fmt, frameCount: frames, framesChecked: files.length };
            } finally { await rm(directory, { recursive: true, force: true }); }
        }
    };
}
