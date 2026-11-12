import { Pool } from 'pg';
import { worldsPilotTarget } from '../src/auth/worlds';
import { sessionEventPublicKey } from '../src/auth/worlds-shared/session-revocation.ts';
import { PROFILE_SCHEMA, PROFILE_MIGRATIONS } from '../src/database/schema';
import { WORLDS_SCHEMA, WORLDS_SESSION_REVOCATION_SCHEMA } from '../src/database/worlds-schema';

async function main() {
    const target = worldsPilotTarget(process.env);
    if (!target) throw new Error('A dedicated Worlds pilot origin and database host are required.');
    const args = process.argv.slice(2);
    const revocationsOnly = args.length === 1 && args[0] === '--session-revocations';
    if (args.length && !revocationsOnly) throw new Error('Unknown pilot schema option.');
    if (revocationsOnly && !sessionEventPublicKey(process.env.WORLDS_HUB_SESSION_EVENT_JWK)) {
        throw new Error('A valid public Worlds Hub event key is required.');
    }
    const statements = revocationsOnly ? WORLDS_SESSION_REVOCATION_SCHEMA : [PROFILE_SCHEMA, ...PROFILE_MIGRATIONS, ...WORLDS_SCHEMA];
    const pool = new Pool({ connectionString: target.database, max: 1, connectionTimeoutMillis: 10_000 });
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const statement of statements) await client.query(statement);
            await client.query('COMMIT');
            console.log('Worlds pilot schema ready.');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}
void main().catch(() => {
    console.error('Worlds pilot schema installation failed. Check the isolated target configuration.');
    process.exitCode = 1;
});
