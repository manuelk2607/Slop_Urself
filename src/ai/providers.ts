export type Provider = 'wan' | 'wan22' | 'wan22-fast' | 'wan22-official' | 'ltx';
export type GenerationQuality = 'auto' | 'quality' | 'economy';
export interface ProviderConfig {
    WAN_PRODUCER_SECRET?: string;
    WAN_SPACE_ID?: string; WAN_SPACE_REVISION?: string; WAN_MODEL_ID?: string; WAN_MODEL_REVISION?: string;
    AI_PROVIDER?: string;
    AI_PROVIDER_CHAIN?: string;
    AI_GPU_SECONDS_PER_ROUND?: string;
    LTX_DURATION?: string;
    HF_SPACE_ID?: string;
    HF_PREDICT_ENDPOINT?: string;
    AI_IMAGE_PROFILE?: string;
}
export interface ProviderBudget { id: Provider; name: string; gpuSeconds: number }
export const DEFAULT_PROVIDER_CHAIN = 'wan22,wan22-fast';

export function generationQuality(value: unknown): GenerationQuality {
    if (value === undefined) return 'auto';
    if (value !== 'auto' && value !== 'quality' && value !== 'economy') throw new Error('Ungültiger KI-Modus.');
    return value;
}
export function qualityConfig<T extends ProviderConfig>(config: T, quality: GenerationQuality = 'auto'): T {
    const chain = config.AI_PROVIDER_CHAIN || DEFAULT_PROVIDER_CHAIN;
    // This is a different, explicit official 50-step recipe. UI quality choices
    // must never turn it silently into the unrelated four/eight-step merge.
    if (parseProviderChain(chain).includes('wan22-official')) return { ...config, AI_PROVIDER_CHAIN: 'wan22-official' };
    // Old explicit configurations remain resumable; new games never fall back to LTX.
    const auto = config.AI_IMAGE_PROFILE === 'bounded' ? parseProviderChain(chain).filter(provider => provider === 'wan22' || provider === 'wan22-fast').join(',') || DEFAULT_PROVIDER_CHAIN : chain;
    return { ...config, AI_PROVIDER_CHAIN: quality === 'quality' ? 'wan22' : quality === 'economy' ? 'wan22-fast' : auto };
}

export function parseProviderChain(value = DEFAULT_PROVIDER_CHAIN): Provider[] {
    const providers = value.split(',').map(s => s.trim()).filter((s): s is Provider => ['wan', 'wan22', 'wan22-fast', 'wan22-official', 'ltx'].includes(s));
    return providers.length ? [...new Set(providers)] : ['wan22', 'wan22-fast'];
}

export const videoDuration = (config: ProviderConfig) => Math.max(5, Math.min(Number(config.LTX_DURATION) || 5, 8.5));
export const providerName = (provider: Provider) => provider === 'wan22-official' ? 'Wan 2.2 offiziell (50 Schritte)' : provider === 'wan22-fast' ? 'Wan 2.2 Sparmodus (4 Schritte)' : provider === 'wan22' ? 'Wan 2.2 (8 Schritte)' : provider === 'ltx' ? 'LTX Video' : 'Wan 2.1';
export const providerSpace = (provider: Provider, config: ProviderConfig) => provider === 'ltx' ? config.HF_SPACE_ID || 'Lightricks/ltx-video-distilled'
    : provider === 'wan' ? 'multimodalart/wan2-1-fast' : config.WAN_SPACE_ID || 'Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom';
export const providerEndpoint = (provider: Provider, config: ProviderConfig) => provider === 'ltx' ? config.HF_PREDICT_ENDPOINT || '/image_to_video' : '/generate_video';
export const providerSteps = (provider: Provider) => provider === 'wan22-official' ? 50 : provider === 'wan22-fast' ? 4 : provider === 'wan22' ? 8 : 6;

export function providerGpuSeconds(provider: Provider, config: ProviderConfig, size?: { width: number; height: number }) {
    const duration = videoDuration(config);
    // Reservation equals the explicit large GPU hard ceiling, not an inference
    // speed claim. Failed/uncertain jobs must not trigger another allocation.
    if (provider === 'wan22-official') return duration === 5 ? Math.max(120, Number(config.AI_GPU_SECONDS_PER_ROUND) || 0) : Infinity;
    // This Wan 2.1 Space supports at most 3.4 seconds; it cannot satisfy the game's minimum.
    if (provider === 'wan') return Infinity;
    const seconds = provider === 'ltx' ? duration > 7 ? 150 : 120
        // Space get_inference_duration(), guidance=1, no interpolation, xlarge costs 2x.
        // Bounded inputs are validated server-side; legacy jobs retain the conservative maximum.
        : Math.ceil(2 * (15 + providerSteps(provider) * 5 * Math.pow((1 + Math.round(duration * 16))
            * (size ? size.width * size.height : 832 * (config.AI_IMAGE_PROFILE === 'bounded' ? 624 : 832)) / (81 * 832 * 624), 1.5)));
    // Live measurements exceeded the Space estimate (~75 / ~122 quota seconds).
    // Calibrate bounded jobs with reserve; legacy jobs keep their existing upper bound.
    const calibrated = config.AI_IMAGE_PROFILE === 'bounded' && provider.startsWith('wan22')
        ? Math.ceil(seconds * (provider === 'wan22' ? 114 : 112) / 100) : seconds;
    return Math.max(calibrated, Math.max(0, Number(config.AI_GPU_SECONDS_PER_ROUND) || 0));
}

export function providerBudgets(config: ProviderConfig): ProviderBudget[] {
    return parseProviderChain(config.AI_PROVIDER_CHAIN || config.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN)
        .map(id => ({ id, name: providerName(id), gpuSeconds: providerGpuSeconds(id, config) }))
        .filter(provider => Number.isFinite(provider.gpuSeconds));
}
