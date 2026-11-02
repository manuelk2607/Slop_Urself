// The HF router and our controlled application are separate authentication
// boundaries. Send the same caller credential to both, never an owner token.
// The application header is limited to the two explicitly reviewed hosts.
const controlledHosts = new Set([
    'manuel2607-slopurself-wan22-validated.hf.space',
    'manuel2607-slopurself-wan22-gpu-test.hf.space'
]);
export function personalHfHeaders(url: string, token?: string): Record<string, string> {
    if (!token) return {};
    if (token.length > 4096 || /[\r\n]/.test(token)) throw new Error('Ungültiger persönlicher HF-Zugang.');
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const target = new URL(url);
    if (target.protocol === 'https:' && !target.username && !target.password && !target.port && controlledHosts.has(target.hostname)) {
        headers['X-HF-Authorization'] = headers.Authorization;
        headers['X-Slop-HF-Authorization'] = headers.Authorization;
    }
    return headers;
}
