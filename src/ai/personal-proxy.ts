import { boundedJson } from '../server/body';
import { personalHfHeaders } from './personal-headers';

const codes = new Set(['validation_scope_unavailable', 'producer_unreachable', 'producer_redirect', 'proxy_response_invalid',
    'personal_authorization_unavailable', 'personal_identity_unavailable', 'personal_proxy_context_unavailable',
    ...[401, 403, 404, 429, 500, 502, 503, 504].map(status => `producer_http_${status}`), 'producer_http_rejected']);
const userFormats = new Set(['object', 'other', 'empty', 'anonymous-label', 'role-label', 'credential-like', 'hex-id', 'uuid', 'json-object', 'json-array', 'other-string']);
const bindingFailures = new Set(['actor_schema_unknown', 'identity_lookup_unavailable', 'identity_changed', 'actor_mismatch', 'context_unavailable']);
export function personalProxyFailure(error: unknown) {
    return error instanceof Error && codes.has(error.message) ? error.message : 'validation_unavailable';
}
export async function probePersonalProxy(token: string) {
    const url = 'https://manuel2607-slopurself-wan22-validated.hf.space/identity';
    let response: Response;
    // Workers rejects redirect:'error' before sending anything. Manual mode plus
    // explicit rejection preserves the no-credential-forwarding boundary.
    try { response = await fetch(url, { redirect: 'manual', headers: personalHfHeaders(url, token), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error('producer_unreachable'); }
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('producer_redirect'); }
    let result: Record<string, unknown>;
    try { result = await boundedJson(response, 8192) as Record<string, unknown>; }
    catch { throw new Error(response.ok ? 'proxy_response_invalid' : codes.has(`producer_http_${response.status}`) ? `producer_http_${response.status}` : 'producer_http_rejected'); }
    if (!response.ok) throw new Error(typeof result?.error === 'string' && codes.has(result.error) ? result.error
        : codes.has(`producer_http_${response.status}`) ? `producer_http_${response.status}` : 'producer_http_rejected');
    if (result?.personalIdentityVerified !== true || typeof result.proxySubjectMatches !== 'boolean' || result.gpuCalls !== 0 || result.billingVerified !== false
        || !Array.isArray(result.proxyClaimKeys) || result.proxyClaimKeys.length > 20
        || result.proxyClaimKeys.some(k => typeof k !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(k))) throw new Error('proxy_response_invalid');
    return { personalIdentityVerified: true, proxySubjectMatches: result.proxySubjectMatches,
        proxyClaimKeys: result.proxyClaimKeys as string[], billingVerified: false, gpuCalls: 0,
        ...(typeof result.proxyUserFormat === 'string' && userFormats.has(result.proxyUserFormat) ? { proxyUserFormat: result.proxyUserFormat } : {}),
        ...(result.proxyBindingFailure === null || typeof result.proxyBindingFailure === 'string' && bindingFailures.has(result.proxyBindingFailure) ? { proxyBindingFailure: result.proxyBindingFailure } : {}) };
}
