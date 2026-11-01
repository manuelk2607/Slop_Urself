import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
// No content or credentials. Counts are reserved BEFORE sending and never
// refunded after an ambiguous network failure. Reopening cannot reset a cap.
export class ManagedRequestBudget {
    private db: DatabaseSync;
    constructor(path: string, private maximum: number) {
        if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10_000) throw new Error('Explicit request limit required');
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(path);
        this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS request_budget (scope TEXT PRIMARY KEY, used INTEGER NOT NULL); INSERT OR IGNORE INTO request_budget VALUES (\'managed-v1\',0)');
        if (path !== ':memory:') chmodSync(path, 0o600);
    }
    reserve() {
        const result = this.db.prepare('UPDATE request_budget SET used=used+1 WHERE scope=? AND used<?').run('managed-v1', this.maximum);
        if (result.changes !== 1) throw new Error('Managed request budget exhausted');
    }
    close() { this.db.close(); }
}
