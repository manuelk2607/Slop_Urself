import { neon } from '@neondatabase/serverless';
import { worldsProductionEnabled } from '../src/auth/worlds';
import { WORLDS_PRODUCTION_VARS } from '../src/auth/worlds-production';
import { reportWorldsLinks } from '../src/auth/worlds-receipts';

async function main() {
    const env = {...process.env, ...WORLDS_PRODUCTION_VARS};
    if (process.argv.length !== 2 || !worldsProductionEnabled(env) ||
        !env.DATABASE_URL || !env.WORLDS_MIGRATION_RECEIPT_PRIVATE_JWK) {
        throw new Error('The Slop production target and its dedicated signing key are required.');
    }
    const sql = neon(env.DATABASE_URL);
    const result = await reportWorldsLinks(env, (text, params) => sql.query(text, params));
    console.log(JSON.stringify(result));
}

void main().catch(() => {
    console.error('Receipt delivery did not complete. Check the target and signing configuration, then retry.');
    process.exitCode = 1;
});
