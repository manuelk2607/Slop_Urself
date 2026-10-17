import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { HfStorage } from './huggingface';

export function nodeHfStorage(directory: string): HfStorage {
    const file = (key: string) => join(directory, createHash('sha256').update(key).digest('hex') + '.json');
    return {
        async get<T>(key: string) {
            try { return JSON.parse(await readFile(file(key), 'utf8')) as T; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        },
        async put(key, value) {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const target = file(key), temp = `${target}.${randomUUID()}.tmp`;
            await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
            await rename(temp, target);
        },
        async delete(key) {
            try { await unlink(file(key)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
    };
}
