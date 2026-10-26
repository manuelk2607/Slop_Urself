import dotenv from 'dotenv';
import { nodeHfStorage } from '../src/auth/node-hf-storage';
import { approvedProvider, verifyProviderIdentity, verifyWanParameters } from '../src/ai/provider-trust';
import { providerSpace } from '../src/ai/providers';
import { buildProviderValues, orderProviderValues } from '../src/ai/generation';
import { boundedJson } from '../src/server/body';
import { join } from 'node:path';

async function main() {
    dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ quiet: true });
    const config = process.env;
    const spaceId = config.WAN_SPACE_ID || providerSpace('wan22', config);
    let configured = false; try { approvedProvider(config); configured = true; } catch { /* Not approved. */ }
    const local = nodeHfStorage(config.HF_LOCAL_STORAGE_DIR || join(process.cwd(), '.local/hf'));
    const expiries = await local.get<Record<string, number>>('hf-expiries') || {};
    const activeLocalConnections = Object.entries(expiries).filter(([key, expiry]) => key.startsWith('hf-connection:') && expiry > Date.now()).length;
    const result = { source: 'read-only-public-HF-and-local-vault-index', checkedAt: new Date().toISOString(), spaceId,
        modelIdentityConfigured: configured, providerReachable: false, sourceAndModelMatch: false, apiContractCompatible: false,
        runtimeStage: 'unverified', sourceRevision: '', activeLocalConnections, productionConnectionsVerified: false,
        billingVerified: false, moderationQualified: false, generationRelease: false, gpuCalls: 0 };
    const get = async (url: string) => {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Public provider unavailable');
        return boundedJson(response, 512 * 1024);
    };
    try {
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(spaceId)) throw new Error('Invalid Space');
        const metadata = await get(`https://huggingface.co/api/spaces/${spaceId}`) as { host?: string; sha?: string; runtime?: { stage?: string } };
        if (!metadata.host || !/^https:\/\/[a-z0-9-]+\.hf\.space$/.test(metadata.host)) throw new Error('Invalid public provider');
        result.sourceRevision = /^[a-f0-9]{40}$/.test(metadata.sha || '') ? metadata.sha! : '';
        result.runtimeStage = ['RUNNING', 'SLEEPING', 'BUILDING', 'PAUSED', 'RUNTIME_ERROR'].includes(metadata.runtime?.stage || '') ? metadata.runtime!.stage! : 'unverified';
        const settings = await get(`${metadata.host}/config`);
        const info = await get(`${metadata.host}/gradio_api/info`) as { named_endpoints?: Record<string, { parameters?: Parameters<typeof orderProviderValues>[0] }> };
        result.providerReachable = true;
        try { verifyProviderIdentity(config, metadata, settings); result.sourceAndModelMatch = true; } catch { /* Remain closed. */ }
        try {
            const parameters = info.named_endpoints?.['/generate_video']?.parameters;
            const values = buildProviderValues('wan22', 'Harmless availability probe; never submitted', null, config);
            verifyWanParameters(parameters, values); orderProviderValues(parameters!, values); result.apiContractCompatible = true;
        } catch { /* Incompatible schema is not approval. */ }
    } catch { /* No secret-bearing URLs/errors in the report. */ }
    console.info(JSON.stringify(result, null, 2));
}
void main().catch(() => { console.error('Readiness check failed; no generation performed.'); process.exitCode = 1; });
