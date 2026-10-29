export function releaseId(value: unknown) {
    // Only deployment identifiers, never arbitrary tags or environment strings.
    return typeof value === 'string' && (/^[a-f0-9]{40}$/i.test(value) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) ? value : undefined;
}

export function releaseResponse(method: string, value: unknown) {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, nosnippet' };
    if (!['GET', 'HEAD'].includes(method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    const version = releaseId(value);
    return new Response(method === 'HEAD' ? null : JSON.stringify({ release: version ?? null }), { status: version ? 200 : 503, headers });
}
