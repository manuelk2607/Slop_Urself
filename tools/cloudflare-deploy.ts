import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { sessionEventContentType, sessionRevocationPath } from '../src/auth/worlds-shared/session-revocation.ts';
import { WORLDS_PRODUCTION_ORIGIN } from '../src/auth/worlds-production';
import { SECRET_NAMES } from './cloudflare-secrets';
import { deploymentMode, productionDeployArgs, REQUIRED_WORLDS_TABLES } from './cloudflare-deploy-config';

const wrangler = 'node_modules/wrangler/bin/wrangler.js';
const config = ['--config', 'cloudflare/wrangler.toml'];

async function verifySessionReceiver() {
    const response = await fetch(WORLDS_PRODUCTION_ORIGIN + sessionRevocationPath, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': sessionEventContentType }, body: 'unsigned-release-readiness-check'
    });
    if (response.status !== 400 || (await response.json() as { err?: unknown }).err !== 'invalid_request') {
        throw new Error('Der produktive Worlds-Abmeldeempfänger ist nicht aktiv.');
    }
}

async function main() {
    const { dryRun } = deploymentMode(process.argv.slice(2));
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!dryRun && account && account !== 'ec3c070d8e4f88d2fc533d7d797f2daa') {
        throw new Error('Verwende das Cloudflare-Konto des produktiven Slop-Urself-Workers.');
    }
    const localEnv = { ...process.env, ...(existsSync('.env.local') ? parse(readFileSync('.env.local')) : {}) };
    const databaseUrl = localEnv.DATABASE_URL ?? (dryRun
        ? 'postgresql://dry-run@ep-holy-voice-b1djk94x-pooler.c-5.eu-central-1.aws.neon.tech/Slop_Urself'
        : undefined);
    const productionArgs = productionDeployArgs(databaseUrl);
    if (!dryRun) {
        const check = spawnSync(process.execPath, [wrangler, 'secret', 'list', ...config], { encoding: 'utf8' });
        if (check.error) throw check.error;
        if (check.status !== 0) {
            process.stderr.write(check.stderr);
            process.exitCode = check.status || 1;
            return;
        }
        const secrets = JSON.parse(check.stdout) as { name: string }[];
        const required = [...SECRET_NAMES, 'WORLDS_MIGRATION_RECEIPT_PRIVATE_JWK'];
        const missing = required.filter(name => !secrets.some(secret => secret.name === name));
        if (missing.length) throw new Error(`Deployment abgebrochen: Cloudflare-Secrets fehlen: ${missing.join(', ')}.`);
        const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true }, max: 1 });
        try {
            const result = await pool.query<{ name: string }>(
                `SELECT relname AS name FROM pg_class WHERE relnamespace='public'::regnamespace AND relname = ANY($1::text[])`,
                [REQUIRED_WORLDS_TABLES]
            );
            const installed = new Set(result.rows.map(row => row.name));
            const absent = REQUIRED_WORLDS_TABLES.filter(name => !installed.has(name));
            if (absent.length) throw new Error(`Worlds-Produktivdeployment abgebrochen: Datenbanktabellen fehlen: ${absent.join(', ')}`);
            const audit = await pool.query<{ ready: boolean }>(`SELECT EXISTS (
                SELECT 1 FROM pg_attribute WHERE attrelid='public.worlds_link_audit'::regclass
                AND attname='legacy_password_verified' AND NOT attisdropped
                AND atttypid='boolean'::regtype AND attnotnull
            ) AS ready`);
            if (!audit.rows[0]?.ready) throw new Error('Worlds-Produktivdeployment abgebrochen: Audit-Spalte für die Altprofil-Übernahme fehlt.');
        } finally { await pool.end(); }
        await verifySessionReceiver();
    }
    const deploy = spawnSync(process.execPath, [wrangler, 'deploy', ...config, '--keep-vars', ...productionArgs,
        ...(dryRun ? ['--dry-run'] : [])], { stdio: 'inherit' });
    if (deploy.error) throw deploy.error;
    process.exitCode = deploy.status ?? 1;
    if (deploy.status === 0 && !dryRun) await verifySessionReceiver();
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
