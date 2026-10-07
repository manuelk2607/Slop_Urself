export interface Profile { id: string; name: string }
export interface ProfileStore {
    create(name: string): Promise<Profile | undefined>;
    find(name: string): Promise<Profile | undefined>;
}
export interface ProfileStorage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }
export const PROFILE_SCHEMA = `create table if not exists user_profiles (
    id text primary key,
    name text not null,
    username_key text not null unique,
    created_at timestamptz not null default now()
)`;

export function profileName(value: unknown) {
    if (typeof value !== 'string') throw new Error('Bitte gib einen Benutzernamen ein.');
    const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 15 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('Bitte waehle einen Benutzernamen mit 1 bis 15 sichtbaren Zeichen.');
    return name;
}
const key = (name: string) => profileName(name).toLowerCase();

export function sqlProfiles(query: (sql: string, values?: string[]) => Promise<Profile[]>): ProfileStore {
    let schemaReady: Promise<unknown> | undefined;
    async function ready() { await (schemaReady ??= query(PROFILE_SCHEMA).catch(error => { schemaReady = undefined; throw error; })); }
    return {
        async create(name) {
            name = profileName(name); await ready();
            // The unique constraint, not a prior SELECT, protects concurrent registrations.
            const rows = await query('insert into user_profiles (id, name, username_key) values ($1, $2, $3) on conflict (username_key) do nothing returning id, name', [crypto.randomUUID(), name, key(name)]);
            return rows[0];
        },
        async find(name) {
            const normalized = key(name); await ready();
            return (await query('select id, name from user_profiles where username_key = $1', [normalized]))[0];
        }
    };
}

// Local no-DB mode and mock Workers use the same name rules; calls must be serialized.
export function storedProfiles(storage: ProfileStorage): ProfileStore {
    let operations: Promise<unknown> = Promise.resolve();
    return {
        create(name) {
            name = profileName(name); const storageKey = `profile:${key(name)}`;
            const result = operations.then(async () => {
                if (await storage.get(storageKey)) return undefined;
                const profile = { id: crypto.randomUUID(), name };
                await storage.put(storageKey, profile); return profile;
            });
            operations = result.catch(() => {});
            return result;
        },
        async find(name) { await operations; return storage.get<Profile>(`profile:${key(name)}`); }
    };
}
