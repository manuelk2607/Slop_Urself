export const privatePath = (pathname: string) => /^\/(api|ws|socket\.io)(\/|$)/.test(pathname) || pathname.startsWith('/.well-known/');

export function indexingResponse(request: Request, response: Response) {
    // A WebSocket handshake must keep its original socket-bearing response.
    if (response.status === 101 || !privatePath(new URL(request.url).pathname)) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow, nosnippet');
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
