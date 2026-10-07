import { neon } from '@neondatabase/serverless';
import { GameRepository } from './repository';
import type { DatabaseDriver, SqlStatement } from './types';

const databases = new Map<string, GameRepository>();
export function getSql(url?: string) {
    return url ? neon(url, { fetchOptions: { signal: AbortSignal.timeout(10_000) } }) : null;
}
export function getDatabase(url?: string) {
    if (!url) return null;
    let database = databases.get(url);
    if (!database) {
        const driver: DatabaseDriver = {
            query: async <T>({ text, values }: SqlStatement) => await getSql(url)!.query(text, values) as T[],
            transaction: async statements => {
                const sql = getSql(url)!;
                await sql.transaction(statements.map(({ text, values }) => sql.query(text, values)));
            }
        };
        database = new GameRepository(driver);
        databases.set(url, database);
    }
    return database;
}
