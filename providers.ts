export type Provider = 'wan' | 'wan22' | 'wan22-fast' | 'ltx';
export interface ProviderConfig {
    AI_PROVIDER?: string;
    AI_PROVIDER_CHAIN?: string;
    AI_GPU_SECONDS_PER_ROUND?: string;
    LTX_DURATION?: string;
    HF_SPACE_ID?: string;
    HF_PREDICT_ENDPOINT?: string;
}
export interface ProviderBudget { id: Provider; name: string; gpuSeconds: number }
export const DEFAULT_PROVIDER_CHAIN = 'wan22,wan22-fast,ltx';

export function parseProviderChain(value = DEFAULT_PROVIDER_CHAIN): Provider[] {
    const providers = value.split(',').map(s => s.trim()).filter((s): s is Provider => ['wan', 'wan22', 'wan22-fast', 'ltx'].includes(s));
    return providers.length ? [...new Set(providers)] : ['wan22', 'wan22-fast', 'ltx'];
}

export const videoDuration = (config: ProviderConfig) => Math.max(5, Math.min(Number(config.LTX_DURATION) || 5, 8.5));
export const providerName = (provider: Provider) => provider === 'wan22-fast' ? 'Wan 2.2 Sparmodus (4 Schritte)' : provider === 'wan22' ? 'Wan 2.2 (8 Schritte)' : provider === 'ltx' ? 'LTX Video' : 'Wan 2.1';
export const providerSpace = (provider: Provider, config: ProviderConfig) => provider === 'ltx' ? config.HF_SPACE_ID || 'Lightricks/ltx-video-distilled'
    : provider === 'wan' ? 'multimodalart/wan2-1-fast' : 'Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom';
export const providerEndpoint = (provider: Provider, config: ProviderConfig) => provider === 'ltx' ? config.HF_PREDICT_ENDPOINT || '/image_to_video' : '/generate_video';
export const providerSteps = (provider: Provider) => provider === 'wan22-fast' ? 4 : provider === 'wan22' ? 8 : 6;

export function providerGpuSeconds(provider: Provider, config: ProviderConfig) {
    const duration = videoDuration(config);
    // This Wan 2.1 Space supports at most 3.4 seconds; it cannot satisfy the game's minimum.
    if (provider === 'wan') return Infinity;
    const seconds = provider === 'ltx' ? duration > 7 ? 150 : 120
        // Space get_inference_duration(), guidance=1, no interpolation, xlarge costs 2x.
        // Use its maximum resized area (832x832), not an assumed input aspect ratio.
        : Math.ceil(2 * (15 + providerSteps(provider) * 5 * Math.pow((1 + Math.round(duration * 16)) * 832 * 832 / (81 * 832 * 624), 1.5)));
    return Math.max(seconds, Math.max(0, Number(config.AI_GPU_SECONDS_PER_ROUND) || 0));
}

export function providerBudgets(config: ProviderConfig): ProviderBudget[] {
    return parseProviderChain(config.AI_PROVIDER_CHAIN || config.AI_PROVIDER || DEFAULT_PROVIDER_CHAIN)
        .map(id => ({ id, name: providerName(id), gpuSeconds: providerGpuSeconds(id, config) }))
        .filter(provider => Number.isFinite(provider.gpuSeconds));
}
