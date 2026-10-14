import { spawnSync } from 'node:child_process';
import { SECRET_NAMES } from './cloudflare-secrets';

const wrangler = 'node_modules/wrangler/bin/wrangler.js';
const config = ['--config', 'cloudflare/wrangler.toml'];
const check = spawnSync(process.execPath, [wrangler, 'secret', 'list', ...config], { encoding: 'utf8' });
if (check.error) throw check.error;
if (check.status !== 0) {
    process.stderr.write(check.stderr);
    process.exit(check.status || 1);
}
const secrets = JSON.parse(check.stdout) as { name: string }[];
const missing = SECRET_NAMES.filter(name => !secrets.some(secret => secret.name === name));
if (missing.length) {
    console.error(`Deployment abgebrochen: Cloudflare-Secrets fehlen: ${missing.join(', ')}. Führe npm run cf:secrets aus.`);
    process.exit(1);
}
const deploy = spawnSync(process.execPath, [wrangler, 'deploy', ...config], { stdio: 'inherit' });
if (deploy.error) throw deploy.error;
process.exitCode = deploy.status ?? 1;
