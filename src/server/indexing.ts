export const privatePath = (pathname: string) => /^\/(api|auth|ws|socket\.io)(\/|$)/.test(pathname) || pathname.startsWith('/.well-known/');

export function indexingResponse(request: Request, response: Response, privateDeployment = false) {
    // A WebSocket handshake must keep its original socket-bearing response.
    if (response.status === 101 || (!privateDeployment && !privatePath(new URL(request.url).pathname))) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow, nosnippet');
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Expose a non-secret deployment identifier only on the isolated pilot.
 * A version override can silently fall back; read this binding, never a request header.
 * Preserve the original socket-bearing WebSocket handshake.
 */
export function pilotVersionResponse(response: Response, privateDeployment: boolean, versionId?: string) {
    if (!privateDeployment || response.status === 101 || !versionId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(versionId)) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Worlds-Pilot-Version', versionId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
