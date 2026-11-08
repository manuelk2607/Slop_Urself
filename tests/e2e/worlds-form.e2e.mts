import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { worldsResponse } from '../../src/auth/worlds';
import { sameOrigin, type AuthConfig } from '../../src/auth/worlds-shared/oidc.ts';

let origin = '';
const server = createServer(async (incoming, outgoing) => {
    try {
        const request = new Request(origin + incoming.url, { method: incoming.method,
            headers: incoming.headers as Record<string, string> });
        if (incoming.method === 'POST') {
            outgoing.writeHead(sameOrigin(request, origin) ? 200 : 403, { 'content-type': 'application/json' });
            outgoing.end(JSON.stringify({ origin: incoming.headers.origin, site: incoming.headers['sec-fetch-site'] }));
            return;
        }
        const config = { origin, issuer: 'https://identity.test/auth', clientId: 'fixture', algorithm: 'EdDSA',
            store: { getSession: async () => null } } as AuthConfig;
        const response = await worldsResponse(request, config, {}, {} as never, async () => []);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(await response.text());
    } catch { outgoing.writeHead(500); outgoing.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
let browser;
try {
    browser = await engine.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 320, height: 740 } });
    await page.goto(origin + '/auth/worlds');
    const posted = page.waitForResponse(response => response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Mit Worlds anmelden', exact: true }).click();
    const response = await posted;
    assert.equal(response.status(), 200, 'Native login forms must retain the Origin required by CSRF protection.');
    assert.deepEqual(await response.json(), { origin, site: 'same-origin' });
    for (const forged of ['null', 'https://untrusted.test']) {
        const denied = await fetch(origin + '/auth/login', { method: 'POST', headers: { origin: forged } });
        assert.equal(denied.status, 403, 'The form fix must not relax Origin verification.');
    }
    console.log('PASS native Worlds login form keeps its same-origin proof; null and foreign origins remain denied');
} finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
