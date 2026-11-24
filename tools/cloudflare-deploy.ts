import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { SECRET_NAMES } from './cloudflare-secrets';
import { deploymentMode, productionDeployArgs, REQUIRED_WORLDS_TABLES } from './cloudflare-deploy-config';

const wrangler = 'node_modules/wrangler/bin/wrangler.js';
const config = ['--config', 'cloudflare/wrangler.toml'];
async function main() {
 const mode = deploymentMode(process.argv.slice(2));
 const localEnv = {...process.env,...(existsSync('.env.local') ? parse(readFileSync('.env.local')) : {})};
 if (!mode.dryRun) {
    const check = spawnSync(process.execPath, [wrangler, 'secret', 'list', ...config], { encoding: 'utf8' });
    if (check.error) throw check.error;
    if (check.status !== 0) {
        process.stderr.write(check.stderr);
        process.exit(check.status || 1);
    }
    const secrets = JSON.parse(check.stdout) as { name: string }[];
    const required = mode.legacyPasswordLink ? [...SECRET_NAMES, 'WORLDS_MIGRATION_RECEIPT_PRIVATE_JWK'] : SECRET_NAMES;
    const missing = required.filter(name => !secrets.some(secret => secret.name === name));
    if (missing.length) {
        console.error(`Deployment abgebrochen: Cloudflare-Secrets fehlen: ${missing.join(', ')}. Führe npm run cf:secrets aus.`);
        process.exit(1);
    }
 }
 let productionArgs: string[] = [];
 if (mode.production) {
    const databaseUrl = localEnv.DATABASE_URL ?? (mode.dryRun
        ? 'postgresql://dry-run@ep-holy-voice-b1djk94x-pooler.c-5.eu-central-1.aws.neon.tech/Slop_Urself'
        : undefined);
    productionArgs = productionDeployArgs(databaseUrl, mode.legacyPasswordLink);
    if (!mode.dryRun) {
        const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true }, max: 1 });
        try {
            const result = await pool.query<{ name: string }>(
                `SELECT relname AS name FROM pg_class WHERE relnamespace='public'::regnamespace AND relname = ANY($1::text[])`,
                [REQUIRED_WORLDS_TABLES]
            );
            const installed = new Set(result.rows.map(row => row.name));
            const absent = REQUIRED_WORLDS_TABLES.filter(name => !installed.has(name));
            if (absent.length) throw new Error(`Worlds-Produktivdeployment abgebrochen: Datenbanktabellen fehlen: ${absent.join(', ')}`);
            if (mode.legacyPasswordLink) {
                const audit = await pool.query<{ ready: boolean }>(`SELECT EXISTS (
                    SELECT 1 FROM pg_attribute WHERE attrelid='public.worlds_link_audit'::regclass
                    AND attname='legacy_password_verified' AND NOT attisdropped
                    AND atttypid='boolean'::regtype AND attnotnull
                ) AS ready`);
                if (!audit.rows[0]?.ready) throw new Error('Worlds-Produktivdeployment abgebrochen: Audit-Spalte für die Altprofil-Übernahme fehlt.');
            }
        } finally { await pool.end(); }
    }
 }
 const deploy = spawnSync(process.execPath, [wrangler, 'deploy', ...config, '--keep-vars', ...productionArgs,
    ...(mode.dryRun ? ['--dry-run'] : [])], { stdio: 'inherit' });
 if (deploy.error) throw deploy.error;
 process.exitCode = deploy.status ?? 1;
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
