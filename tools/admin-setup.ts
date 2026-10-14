import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { profileName } from '../src/auth/profiles';

async function main() {
    const name = profileName(process.argv[2]);
    const source = readFileSync('.env.local', 'utf8');
    const env = parse(source);
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL fehlt in .env.local.');
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    let profile: { id: string; name: string } | undefined;
    try { profile = (await client.query('select id, name from user_profiles where username_key = $1', [name.toLowerCase()])).rows[0]; }
    finally { await client.end(); }
    if (!profile) throw new Error('Der Besitzer muss bereits als Benutzer registriert sein.');
    if (env.ADMIN_ACCOUNT_ID && env.ADMIN_ACCOUNT_ID !== profile.id) throw new Error('Ein anderes Besitzerkonto ist bereits eingerichtet. Bitte ändere ADMIN_ACCOUNT_ID bewusst in .env.local.');
    const key = env.ADMIN_ACCESS_KEY && env.ADMIN_ACCESS_KEY.length >= 32 ? env.ADMIN_ACCESS_KEY : randomBytes(32).toString('base64url');
    const lines = source.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?ADMIN_(?:ACCOUNT_ID|ACCESS_KEY)\s*=/.test(line));
    const next = `${lines.join('\n').trimEnd()}\nADMIN_ACCOUNT_ID=${JSON.stringify(profile.id)}\nADMIN_ACCESS_KEY=${JSON.stringify(key)}\n`;
    writeFileSync('.env.local', next, { mode: 0o600 }); chmodSync('.env.local', 0o600);
    writeFileSync('.admin-access.txt', `Besitzer: ${profile.name}\n\nVerwaltungsschlüssel:\n${key}\n\nNur für dich. Nicht an Freunde weitergeben und nicht ins Repository aufnehmen.\n`, { mode: 0o600 });
    chmodSync('.admin-access.txt', 0o600);
    console.log(`Benutzerverwaltung für ${profile.name} vorbereitet. Der private Schlüssel liegt in .admin-access.txt; es wurden keine Benutzer oder Spiele gelöscht.`);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Einrichtung fehlgeschlagen.'); process.exitCode = 1; });
