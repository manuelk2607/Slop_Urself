import { build } from 'esbuild';
import { Miniflare, Response, type V4FetchHandler } from 'miniflare';
import { resolve } from 'node:path';

// No dotenv or Wrangler secret discovery: all external calls fail unless a test explicitly stubs them.
export async function cloudflareRuntime(options: { port?: number; bindings?: Record<string, string>; outboundService?: V4FetchHandler } = {}) {
    const bundle = await build({ entryPoints: ['src/server/cloudflare/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
    const bindings = { AI_PROVIDER: 'mock', AI_ROUND_LIMIT: '5', AI_IMAGE_PROFILE: 'bounded', AUTH_MODE: 'disabled',
        AUTH_COOKIE_SECRET: 'cloudflare-test-cookie-secret-at-least-32-characters', ...options.bindings };
    const runtime = new Miniflare({ host: '127.0.0.1', port: options.port ?? 0, logRequests: false, telemetry: { enabled: false },
        workers: [{ config: { name: 'slopurself-test', compatibilityDate: '2026-10-03',
            manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
            exports: { RoomDurableObject: { type: 'durable-object', storage: 'sqlite' }, ServiceDurableObject: { type: 'durable-object', storage: 'sqlite' } },
            env: { ...Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, { type: 'text' as const, value }])),
                ASSETS: { type: 'assets' }, ROOMS: { type: 'durable-object', worker: 'slopurself-test', exportName: 'RoomDurableObject' },
                SERVICES: { type: 'durable-object', worker: 'slopurself-test', exportName: 'ServiceDurableObject' } },
            assets: { directory: resolve('cloudflare/public'), hasUserWorker: true, notFoundHandling: 'none', runWorkerFirst: ['/api/*', '/ws/*', '/socket.io/*'] } },
            dev: { outboundService: { type: 'fetcher', handler: options.outboundService ?? (() => new Response('External network is disabled in tests.', { status: 503 })) } } }] });
    try { await runtime.ready; return runtime; }
    catch (error) { await runtime.dispose(); throw error; }
}
