import type { ProviderConfig } from './providers';
export interface ProviderIdentity { spaceId: string; spaceRevision: string; modelId: string; modelRevision: string }
export class ProviderTrustError extends Error {
    constructor() { super('Das KI-Modell ist noch nicht freigegeben oder der Anbieter hat seinen Modellstand geändert. Es wurde kein Videoauftrag gestartet.'); }
}
const repo = (value: string | undefined): value is string => Boolean(value && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value));
const revision = (value: string | undefined): value is string => Boolean(value && /^[a-f0-9]{40}$/.test(value));
export function approvedProvider(config: ProviderConfig): ProviderIdentity {
    if (!repo(config.WAN_SPACE_ID) || !repo(config.WAN_MODEL_ID) || !revision(config.WAN_SPACE_REVISION) || !revision(config.WAN_MODEL_REVISION)) throw new ProviderTrustError();
    return { spaceId: config.WAN_SPACE_ID, spaceRevision: config.WAN_SPACE_REVISION, modelId: config.WAN_MODEL_ID, modelRevision: config.WAN_MODEL_REVISION };
}
export function verifyProviderIdentity(config: ProviderConfig, metadata: unknown, settings: unknown) {
    const expected = approvedProvider(config);
    const source = metadata as { sha?: unknown; runtime?: { sha?: unknown } } | null;
    const runtime = settings as { slop_model?: { id?: unknown; revision?: unknown } } | null;
    if (source?.sha !== expected.spaceRevision || source.runtime?.sha !== expected.spaceRevision
        || runtime?.slop_model?.id !== expected.modelId || runtime.slop_model.revision !== expected.modelRevision) throw new ProviderTrustError();
    return expected;
}
