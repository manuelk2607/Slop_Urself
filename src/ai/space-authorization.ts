import { boundedJson } from '../server/body';

// Official HF resource-token endpoint. Read access to this one public Space,
// five minutes, no writes/inference-provider scope, no token exposed to clients.
export async function personalSpaceAuthorization(personalToken: string) {
    const url = 'https://huggingface.co/api/spaces/Manuel2607/SlopUrself-Wan22-Validated/jwt?expires_in=300&billing_details=true';
    let response: Response;
    try { response = await fetch(url, { headers: { Authorization: `Bearer ${personalToken}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new Error('space_access_unavailable'); }
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('space_access_redirect'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error('space_access_rejected'); }
    try {
        const value = await boundedJson(response, 32_768) as { token?: unknown; accessToken?: unknown; exp?: unknown };
        if (typeof value?.token !== 'string' || value.token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token)) throw new Error();
        const payload = JSON.parse(atob(value.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
        const expiry = value.exp ?? payload.exp;
        if (!Number.isSafeInteger(expiry) || Number(expiry) <= Date.now() / 1000 + 10 || Number(expiry) > Date.now() / 1000 + 315
            || payload.exp !== undefined && payload.exp !== expiry) throw new Error();
        // The live HF contract's legacy accessToken is not token with a Bearer
        // prefix. Use only the explicitly returned raw, expiry-checked JWT.
        return `Bearer ${value.token}`;
    } catch { throw new Error('space_access_invalid'); }
}
