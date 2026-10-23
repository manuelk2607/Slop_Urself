export const PUBLIC_ORIGIN = 'https://slopurself.maki26.workers.dev';

export const ROBOTS_TEXT = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /ws/
Disallow: /socket.io/
Disallow: /.well-known/

Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml
`;

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${PUBLIC_ORIGIN}/</loc></url>
</urlset>
`;

export function publicSeoResponse(pathname: string, method: string): Response | undefined {
    const asset = pathname === '/robots.txt'
        ? { body: ROBOTS_TEXT, contentType: 'text/plain' }
        : pathname === '/sitemap.xml'
            ? { body: SITEMAP_XML, contentType: 'application/xml' }
            : undefined;
    if (!asset) return undefined;
    if (method !== 'GET' && method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    return new Response(method === 'HEAD' ? null : asset.body, { headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
        'X-Content-Type-Options': 'nosniff'
    } });
}
