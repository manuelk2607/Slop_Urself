import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

async function main() {
    rmSync('dist', { recursive: true, force: true });
    for (const config of ['tsconfig.json', 'cloudflare/tsconfig.json']) {
        const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', config], { stdio: 'inherit' });
        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
    await build({ entryPoints: { script: 'src/client/app.ts', startup: 'src/client/startup.ts' },
        bundle: true, minify: true, platform: 'browser', format: 'iife', outdir: 'public' });
    mkdirSync('cloudflare/public', { recursive: true });
    for (const entry of readdirSync('cloudflare/public')) {
        if (entry !== 'README.md') rmSync(`cloudflare/public/${entry}`, { recursive: true, force: true });
    }
    cpSync('public', 'cloudflare/public', { recursive: true });
    cpSync('public/apple-touch-icon.png', 'cloudflare/public/apple-touch-icon-precomposed.png');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
