import { spawn } from 'node:child_process';
import { cloudflareRuntime } from './support/cloudflare';

const children = new Set<ReturnType<typeof spawn>>();
let cloudflare: Awaited<ReturnType<typeof cloudflareRuntime>> | undefined;
let cloudflareProfiles: Awaited<ReturnType<typeof cloudflareRuntime>> | undefined;
const env = { ...process.env, DATABASE_URL: '', HF_TOKEN: '', AI_PROVIDER: 'mock', ADMIN_ACCOUNT_ID: '', ADMIN_ACCESS_KEY: '',
    HF_OAUTH_CLIENT_ID: '', HF_OAUTH_ORIGIN: '', HF_OAUTH_ENCRYPTION_KEY: '',
    MODERATION_URL: '', MODERATION_SECRET: '', MODERATION_POLICY_VERSION: '', MODERATION_MODEL_VERSION: '',
    WAN_SPACE_ID: '', WAN_SPACE_REVISION: '', WAN_MODEL_ID: '', WAN_MODEL_REVISION: '',
    AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', TEST_PROFILE_DB: 'false',
    AUTH_COOKIE_SECRET: 'ci-only-cookie-secret-at-least-32-characters' };
async function run(args: string[], extra: Record<string, string> = {}) {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], { env: { ...env, ...extra }, stdio: 'inherit' });
    children.add(child);
    const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    children.delete(child);
    if (code !== 0) throw new Error(`Test failed: ${args.join(' ')}`);
}
async function start(port: number, auth: boolean) {
    const child = spawn(process.execPath, ['dist/server/node.js'], { env: { ...env, PORT: String(port), AUTH_MODE: auth ? '' : 'disabled' }, stdio: ['ignore', 'pipe', 'inherit'] });
    children.add(child);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 15_000);
        child.stdout.on('data', data => { if (String(data).includes('Server läuft')) { clearTimeout(timer); resolve(); } });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited: ${code}`)); });
    });
}
async function cleanup() {
    await Promise.all([...children].map(child => new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); })));
    children.clear();
    await cloudflare?.dispose(); cloudflare = undefined;
    await cloudflareProfiles?.dispose(); cloudflareProfiles = undefined;
}
process.once('SIGTERM', () => { void cleanup().then(() => process.exit(143)); });
process.once('SIGINT', () => { void cleanup().then(() => process.exit(130)); });
try {
    await start(3310, false); await start(3312, true); await start(3313, false);
    await run(['tests/e2e/security.e2e.mts', 'http://127.0.0.1:3313']);
    await run(['tests/integration/cloudflare-runtime.mts']);
    await run(['tests/integration/hf-runtime.mts']);
    cloudflare = await cloudflareRuntime({ port: 3311 });
    cloudflareProfiles = await cloudflareRuntime({ port: 3314, bindings: { AUTH_MODE: '' } });
    for (const engine of (process.env.TEST_BROWSER_ENGINE ? [process.env.TEST_BROWSER_ENGINE] : ['chromium', 'webkit'])) {
        const browserEnv = { TEST_BROWSER_ENGINE: engine, TEST_BROWSER_PATH: engine === 'webkit' ? '' : process.env.TEST_BROWSER_PATH || '' };
        for (const port of [3310, 3311]) await run(['tests/e2e/seo.e2e.mts', `http://127.0.0.1:${port}`], browserEnv);
        for (const port of [3310, 3311]) await run(['tests/e2e/accessibility.e2e.mts', `http://127.0.0.1:${port}`], browserEnv);
        await run(['tests/e2e/browser.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/e2e/video.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/e2e/statistics.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/e2e/history.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/e2e/undo-batch.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/e2e/variants.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/e2e/party.e2e.mts'], browserEnv);
        for (const port of [3310, 3311]) await run(['tests/e2e/ten-player.e2e.mts', `http://127.0.0.1:${port}`], browserEnv);
        await run(['tests/e2e/accounts.e2e.mts'], browserEnv);
        await run(['tests/e2e/startup.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/e2e/auth.e2e.mts', 'http://127.0.0.1:3312'], browserEnv);
        await run(['tests/e2e/huggingface.e2e.mts'], browserEnv);
        for (const port of [3312, 3314]) await run(['tests/e2e/classic.e2e.mts', `http://127.0.0.1:${port}`], browserEnv);
        for (const port of [3312, 3314]) await run(['tests/e2e/participants.e2e.mts', `http://127.0.0.1:${port}`], browserEnv);
        await run(['tests/e2e/quota.e2e.mts'], browserEnv);
        await run(['tests/e2e/extension.e2e.mts'], browserEnv);
        for (const file of ['browser', 'video', 'statistics', 'history', 'variants']) {
            await run([`tests/e2e/${file}.e2e.mts`, 'http://127.0.0.1:3311'], browserEnv);
        }
    }
} finally { await cleanup(); }
