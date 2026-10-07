import { spawn } from 'node:child_process';

const children = new Set<ReturnType<typeof spawn>>();
const env = { ...process.env, DATABASE_URL: '', HF_TOKEN: '', AI_PROVIDER: 'mock',
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
    const child = spawn(process.execPath, ['dist/server.js'], { env: { ...env, PORT: String(port), AUTH_MODE: auth ? '' : 'disabled' }, stdio: ['ignore', 'pipe', 'inherit'] });
    children.add(child);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 15_000);
        child.stdout.on('data', data => { if (String(data).includes('Server laeuft')) { clearTimeout(timer); resolve(); } });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited: ${code}`)); });
    });
}
async function cleanup() {
    await Promise.all([...children].map(child => new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); })));
    children.clear();
}
process.once('SIGTERM', () => { void cleanup().then(() => process.exit(143)); });
process.once('SIGINT', () => { void cleanup().then(() => process.exit(130)); });
try {
    await start(3310, false); await start(3312, true); await start(3313, false);
    await run(['tests/security.e2e.mts', 'http://127.0.0.1:3313']);
    for (const engine of (process.env.TEST_BROWSER_ENGINE ? [process.env.TEST_BROWSER_ENGINE] : ['chromium', 'webkit'])) {
        const browserEnv = { TEST_BROWSER_ENGINE: engine, TEST_BROWSER_PATH: engine === 'webkit' ? '' : process.env.TEST_BROWSER_PATH || '' };
        await run(['tests/browser.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/startup.e2e.mts', 'http://127.0.0.1:3310'], browserEnv);
        await run(['tests/auth.e2e.mts', 'http://127.0.0.1:3312'], browserEnv);
        await run(['tests/quota.e2e.mts'], browserEnv);
        await run(['tests/extension.e2e.mts'], browserEnv);
    }
} finally { await cleanup(); }
