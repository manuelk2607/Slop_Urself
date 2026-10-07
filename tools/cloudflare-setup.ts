import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';

const env = parse(readFileSync('.env.local'));
const names = ['HF_TOKEN', 'DATABASE_URL', 'AUTH_COOKIE_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
const missing = names.filter(name => !env[name]);
if (missing.length) throw new Error(`Fehlende Werte in .env.local: ${missing.join(', ')}`);
const secrets = Object.fromEntries(names.map(name => [name, env[name]]));
if (process.argv[2] === 'local') {
    writeFileSync('cloudflare/.dev.vars', Object.entries(secrets).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
    console.log('Lokale Cloudflare-Secrets vorbereitet (ignorierte .dev.vars).');
} else if (process.argv[2] === 'invite') {
    console.log('https://slopurself.jsbk9gv78n.workers.dev/');
} else if (process.argv[2] === 'upload') {
    const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk', '--config', 'cloudflare/wrangler.toml'], { input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit'] });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} else throw new Error('Modus: local, upload oder invite.');
