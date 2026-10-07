import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { prepareSecrets } from './cloudflare-secrets';

const mode = process.argv[2];
if (mode === 'invite') {
    console.log('https://slopurself.jsbk9gv78n.workers.dev/');
} else if (mode === 'local' || mode === 'upload') {
    const env = parse(readFileSync('.env.local'));
    const secrets = prepareSecrets(env, mode === 'upload' ? process.argv.slice(3) : []);
    if (mode === 'local') {
        writeFileSync('cloudflare/.dev.vars', Object.entries(secrets).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
        console.log('Lokale Cloudflare-Secrets vorbereitet (ignorierte .dev.vars).');
    } else {
        const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk', '--config', 'cloudflare/wrangler.toml'], { input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit'] });
        if (result.error) throw result.error;
        process.exitCode = result.status ?? 1;
    }
} else throw new Error('Modus: local, upload [Secret-Namen] oder invite.');
