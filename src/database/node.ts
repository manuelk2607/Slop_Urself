import { Pool } from 'pg';
import { type ProfileStore, sqlProfiles, storedProfiles } from '../auth/profiles';
import { GameRepository } from './repository';
import { emptyStats, type DatabaseDriver, type SqlStatement, type PersistPlayerInput, type PersistRoundInput, type FinalStandingInput } from './types';

let pool: Pool | undefined;
let database: GameRepository | undefined;
let profiles: ProfileStore | undefined;
const localProfiles = new Map<string, unknown>();

function getPool() {
    if (!process.env.DATABASE_URL) return null;
    return pool ??= new Pool({ connectionString: process.env.DATABASE_URL,
        max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
}
function getDatabase() {
    const pool = getPool();
    if (!pool) return null;
    if (!database) {
        const driver: DatabaseDriver = {
            query: async <T>({ text, values }: SqlStatement) => (await pool.query(text, values)).rows as T[],
            async transaction(statements) {
                const client = await pool.connect();
                try {
                    await client.query('begin');
                    for (const { text, values } of statements) await client.query(text, values);
                    await client.query('commit');
                } catch (error) { await client.query('rollback'); throw error; }
                finally { client.release(); }
            }
        };
        database = new GameRepository(driver);
    }
    return database;
}
export function getProfiles() {
    if (profiles) return profiles;
    const pool = getPool();
    return profiles = pool ? sqlProfiles(async (text, values) => (await pool.query(text, values)).rows) : storedProfiles({
        get: async <T>(key: string) => structuredClone(localProfiles.get(key)) as T | undefined,
        put: async (key, value) => { localProfiles.set(key, structuredClone(value)); }
    });
}
export const isDatabaseEnabled = () => Boolean(getPool());
export const ensureDatabaseSchema = async () => { await getDatabase()?.ensureSchema(); };
export const roomExists = async (code: string) => await getDatabase()?.roomExists(code) ?? false;
export const saveRoom = async (code: string, hostId: string, rounds: number) => { await getDatabase()?.saveRoom(code, hostId, rounds); };
export const savePlayer = async (input: PersistPlayerInput) => { await getDatabase()?.savePlayer(input); };
export const saveScores = async (code: string, players: NonNullable<PersistRoundInput['players']>, hostId: string) => { await getDatabase()?.saveScores(code, players, hostId); };
export const markRoomStarted = async (code: string) => { await getDatabase()?.markRoomStarted(code); };
export const markRoomFinished = async (code: string, standings: FinalStandingInput[]) => { await getDatabase()?.markRoomFinished(code, standings); };
export const reopenRoom = async (code: string, rounds: number, hostId: string) => { await getDatabase()?.reopenRoom(code, rounds, hostId); };
export const saveRound = async (input: PersistRoundInput) => { await getDatabase()?.saveRound(input); };
export const getStats = async () => await getDatabase()?.getStats() ?? emptyStats();
