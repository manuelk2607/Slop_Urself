import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JobInput { stage: 'input' | 'output'; image?: string; prompt?: string; video?: string; mime?: string }
export interface StoredJob { id: string; digest: string; evaluation: boolean; status: 'pending' | 'running' | 'complete' | 'failed'; expiresAt: number; attempts: number; result?: object }
interface Row { id: string; digest: string; evaluation: number; status: StoredJob['status']; expires: number; attempts: number; lease: number; run: string | null; payload: Uint8Array; result: Uint8Array | null }

// A local SQLite volume survives process restarts. The host must preserve this
// volume; ephemeral Space disks do not provide a cross-rebuild durability promise.
export class ModerationJobs {
    private db: DatabaseSync;
    private key: Buffer;
    constructor(path: string, secret: string, private version: string, private now = Date.now) {
        if (secret.length < 32) throw new Error('Job encryption key required');
        this.key = createHash('sha256').update('slop-moderation-jobs-v1\0').update(secret).digest();
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(path);
        if (path !== ':memory:') chmodSync(path, 0o600);
        this.db.exec('PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, evaluation INTEGER NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0, run TEXT, payload BLOB NOT NULL, result BLOB, UNIQUE(digest,evaluation,version));');
    }
    private seal(value: unknown, aad: string) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(Buffer.from(aad));
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    }
    private open(bytes: Uint8Array, aad: string): unknown {
        const b = Buffer.from(bytes), decipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
        decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(b.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8'));
    }
    private transaction<T>(operation: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try { const result = operation(); this.db.exec('COMMIT'); return result; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    prune() { this.db.prepare('DELETE FROM jobs WHERE expires <= ?').run(this.now()); }
    create(digest: string, evaluation: boolean, input: JobInput): StoredJob {
        if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid digest');
        return this.transaction(() => {
            this.prune();
            const previous = this.db.prepare('SELECT * FROM jobs WHERE digest=? AND evaluation=? AND version=?').get(digest, Number(evaluation), this.version) as unknown as Row | undefined;
            if (previous) return this.view(previous);
            if ((this.db.prepare('SELECT COUNT(*) AS n FROM jobs').get()!.n as number) >= 4) throw new Error('Job capacity');
            const id = randomUUID(), expires = this.now() + 360_000;
            const payload = this.seal(input, `${id}:${digest}:${evaluation}:${this.version}:input`);
            if (payload.length > 24 * 1024 * 1024) throw new Error('Payload too large');
            this.db.prepare("INSERT INTO jobs(id,digest,evaluation,version,status,expires,payload) VALUES(?,?,?,?,'pending',?,?)").run(id, digest, Number(evaluation), this.version, expires, payload);
            return this.get(id, digest)!;
        });
    }
    private view(row: Row): StoredJob {
        const result = row.result ? this.open(row.result, `${row.id}:${row.digest}:${Boolean(row.evaluation)}:${this.version}:result`) as object : undefined;
        return { id: row.id, digest: row.digest, evaluation: Boolean(row.evaluation), status: row.status, expiresAt: row.expires, attempts: row.attempts, ...(result ? { result } : {}) };
    }
    get(id: string, digest: string) {
        this.prune();
        const row = this.db.prepare('SELECT * FROM jobs WHERE id=? AND digest=? AND version=?').get(id, digest, this.version) as unknown as Row | undefined;
        return row ? this.view(row) : undefined;
    }
    lookup(digest: string, evaluation: boolean) {
        this.prune();
        const row = this.db.prepare('SELECT * FROM jobs WHERE digest=? AND evaluation=? AND version=?').get(digest, Number(evaluation), this.version) as unknown as Row | undefined;
        return row ? this.view(row) : undefined;
    }
    claim() {
        return this.transaction(() => {
            this.prune(); const now = this.now();
            // A stale worker cannot approve a result after its lease. Exhausted
            // jobs retain a failed ticket, never silently start fresh work.
            this.db.prepare("UPDATE jobs SET status='failed', payload=x'' WHERE status='running' AND lease<=? AND attempts>=2").run(now);
            if (this.db.prepare("SELECT id FROM jobs WHERE status='running' AND lease>?").get(now)) return;
            const row = this.db.prepare("SELECT * FROM jobs WHERE version=? AND (status='pending' OR (status='running' AND lease<=? AND attempts<2)) ORDER BY expires LIMIT 1").get(this.version, now) as unknown as Row | undefined;
            if (!row) return;
            const input = this.open(row.payload, `${row.id}:${row.digest}:${Boolean(row.evaluation)}:${this.version}:input`) as JobInput;
            const run = randomUUID(), lease = Math.min(row.expires, now + 300_000);
            this.db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, run=?, lease=? WHERE id=?").run(run, lease, row.id);
            return { ...this.view(row), input, run, lease };
        });
    }
    finish(id: string, run: string, result?: object) {
        const row = this.db.prepare("SELECT * FROM jobs WHERE id=? AND run=? AND version=? AND status='running' AND lease>? AND expires>?").get(id, run, this.version, this.now(), this.now()) as unknown as Row | undefined;
        if (!row) return false;
        if (result && Buffer.byteLength(JSON.stringify(result)) > 16_384) throw new Error('Result too large');
        const bytes = result ? this.seal(result, `${id}:${row.digest}:${Boolean(row.evaluation)}:${this.version}:result`) : null;
        const updated = this.db.prepare("UPDATE jobs SET status=?, result=?, payload=x'' WHERE id=? AND run=? AND status='running' AND lease>? AND expires>?")
            .run(result ? 'complete' : 'failed', bytes, id, run, this.now(), this.now());
        return updated.changes === 1;
    }
    counts() {
        this.prune();
        return this.db.prepare('SELECT status, COUNT(*) AS count FROM jobs WHERE version=? GROUP BY status').all(this.version);
    }
    close() { this.db.close(); this.key.fill(0); }
}
