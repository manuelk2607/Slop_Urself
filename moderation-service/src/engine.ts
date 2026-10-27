import { AutoProcessor, AutoModelForVision2Seq, RawImage, Tensor, pipeline, env, InterruptableStoppingCriteria } from '@huggingface/transformers';
import sharp from 'sharp';
import { ensureModelArtifacts, modelCacheRoot } from './artifacts.js';
import { assess, policyFor, type Assessment, type Decision, type ModelLock, type Scores } from './policy.js';
import { checkAbort, inspectVideo, MAX_MEDIA_EDGE } from './media.js';
import { configureContextImages } from './preprocessing.js';

// The non-root container cannot write Transformers.js' node_modules cache.
// Only pinned model weights, never player media, belong in this directory.
env.cacheDir = modelCacheRoot();
export interface ModelAssessment extends Assessment {
    format: { generatedTokens: number; atTokenLimit: boolean; fenced: boolean; startsObject: boolean; endsObject: boolean };
}
export async function createEngine(lock: ModelLock, stage: (stage: string) => void | Promise<void> = () => {}, observe: (assessment: ModelAssessment) => void = () => {}) {
    const policy = policyFor(lock.decisionProtocol), maxTokens = lock.decisionProtocol === 'labels-v1' ? 12 : 96;
    await stage('verifying_model_files');
    await ensureModelArtifacts(lock);
    const session_options = { intraOpNumThreads: 2, interOpNumThreads: 1 };
    await stage('loading_classifier');
    const classifier = await pipeline('image-classification', lock.nsfw.id, { revision: lock.nsfw.revision, device: 'cpu', dtype: 'fp32', session_options });
    await stage('loading_context_model');
    const processor = await AutoProcessor.from_pretrained(lock.vlm.id, { revision: lock.vlm.revision });
    configureContextImages(processor.image_processor);
    const model = await AutoModelForVision2Seq.from_pretrained(lock.vlm.id, { revision: lock.vlm.revision, device: 'cpu', dtype: 'fp32', session_options });
    await stage('models_ready');
    async function inspect(bytes: Uint8Array, prompt: string, signal?: AbortSignal): Promise<Decision> {
        checkAbort(signal);
        const image = await sharp(bytes, { limitInputPixels: 832 * 832, failOn: 'error' }).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixels = new RawImage(new Uint8Array(image.data), image.info.width, image.info.height, 3);
        const scores = await classifier(pixels, { top_k: 2 }) as Scores[];
        checkAbort(signal);
        const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: `${policy}\nQuoted proposed action: ${JSON.stringify(prompt)}` }] }];
        // The model's multimodal template accepts content blocks; v3's shared
        // Message declaration still describes text-only messages.
        const text = processor.apply_chat_template(messages as unknown as Parameters<typeof processor.apply_chat_template>[0], { add_generation_prompt: true });
        const inputs = await processor(text, pixels);
        const stopping = new InterruptableStoppingCriteria();
        const interrupt = () => stopping.interrupt();
        signal?.addEventListener('abort', interrupt, { once: true });
        let generated: Awaited<ReturnType<typeof model.generate>>;
        try {
            checkAbort(signal);
            generated = await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, stopping_criteria: [stopping] });
            checkAbort(signal);
        } finally { signal?.removeEventListener('abort', interrupt); }
        const inputIds = inputs.input_ids;
        if (!(generated instanceof Tensor) || !(inputIds instanceof Tensor) || inputIds.dims.length !== 2) throw new Error('Unexpected model output');
        // Decode only new tokens. JSON in quoted input or the policy template
        // must never be mistaken for the model's classification.
        const output = processor.batch_decode(generated.slice(null, [inputIds.dims[1], generated.dims[1]]), { skip_special_tokens: true })[0];
        const assessment = assess(scores, output.trim(), lock.decisionProtocol);
        const generatedTokens = generated.dims[1] - inputIds.dims[1];
        observe({ ...assessment, format: { generatedTokens, atTokenLimit: generatedTokens >= maxTokens, fenced: output.trim().startsWith('```'),
            startsObject: output.trim().startsWith('{'), endsObject: output.trim().endsWith('}') } });
        // Diagnostic callback only; no raw response, and the server sets no observer.
        return assessment.decision;
    }
    return {
        input: async (image: string, prompt: string, signal?: AbortSignal) => {
            const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
            if (!match || match[1].length % 4 || match[1].length > 12 * 1024 * 1024) throw new Error('Invalid normalized input');
            const bytes = Buffer.from(match[1], 'base64');
            if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Expected actual PNG');
            const metadata = await sharp(bytes, { limitInputPixels: 832 * 832, failOn: 'error' }).metadata();
            if (metadata.format !== 'png' || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height
                || metadata.width > MAX_MEDIA_EDGE || metadata.height > MAX_MEDIA_EDGE) throw new Error('Expected a bounded single decoded image');
            return { decision: await inspect(bytes, prompt, signal), decodeComplete: true };
        },
        output: (video: string, signal?: AbortSignal) => inspectVideo(video, (frame, signal) => inspect(frame, 'Classify this video frame under the same safety policy.', signal), signal)
    };
}
