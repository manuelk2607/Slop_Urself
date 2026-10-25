export const privatePath = (pathname: string) => /^\/(api|ws|socket\.io)(\/|$)/.test(pathname) || pathname.startsWith('/.well-known/');

export function indexingResponse(request: Request, response: Response) {
    // A WebSocket handshake must keep its original socket-bearing response.
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders(new URL(request.url).origin))) headers.set(name, value);
    if (privatePath(new URL(request.url).pathname)) {
        headers.set('X-Robots-Tag', 'noindex, nofollow, nosnippet');
        headers.set('Cache-Control', 'no-store');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
import { securityHeaders } from '../security/headers';
