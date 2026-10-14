import { PROFILE_SCHEMA } from '../database/schema';

export interface Profile { id: string; name: string }
export interface ProfileStore {
    create(name: string): Promise<Profile | undefined>;
    find(name: string): Promise<Profile | undefined>;
}
export interface ManagedProfileStore extends ProfileStore {
    list(): Promise<Profile[]>;
    remove(id: string): Promise<Profile | undefined>;
}
export interface ProfileStorage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }

export function profileName(value: unknown) {
    if (typeof value !== 'string') throw new Error('Bitte gib einen Benutzernamen ein.');
    const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 15 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('Bitte wähle einen Benutzernamen mit 1 bis 15 sichtbaren Zeichen.');
    return name;
}
const key = (name: string) => profileName(name).toLowerCase();

export function sqlProfiles(query: (sql: string, values?: string[]) => Promise<Profile[]>): ManagedProfileStore {
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
        },
        async list() { await ready(); return query('select id, name from user_profiles order by lower(name), id'); },
        async remove(id) { await ready(); return (await query('delete from user_profiles where id = $1 returning id, name', [id]))[0]; }
    };
}

// Local no-DB mode and mock Workers use the same name rules; calls must be serialized.
export function storedProfiles(storage: ProfileStorage): ManagedProfileStore {
    let operations: Promise<unknown> = Promise.resolve();
    function serialize<T>(action: () => Promise<T>) {
        const result = operations.then(action); operations = result.catch(() => {}); return result;
    }
    async function remember(profile: Profile) {
        const index = await storage.get<Profile[]>('profileIndex') || [];
        if (!index.some(item => item.id === profile.id)) await storage.put('profileIndex', [...index, profile]);
    }
    return {
        create(name) {
            name = profileName(name); const storageKey = `profile:${key(name)}`;
            return serialize(async () => {
                if (await storage.get(storageKey)) return undefined;
                const profile = { id: crypto.randomUUID(), name };
                await storage.put(storageKey, profile); await remember(profile); return profile;
            });
        },
        find(name) { return serialize(async () => {
            const profile = await storage.get<Profile>(`profile:${key(name)}`) || undefined;
            if (profile) await remember(profile);
            return profile;
        }); },
        list() { return serialize(async () => {
            const index = await storage.get<Profile[]>('profileIndex') || [];
            const profiles = await Promise.all(index.map(item => storage.get<Profile>(`profile:${key(item.name)}`)));
            return profiles.filter((item): item is Profile => Boolean(item)).sort((a, b) => a.name.localeCompare(b.name));
        }); },
        remove(id) { return serialize(async () => {
            const index = await storage.get<Profile[]>('profileIndex') || [];
            const profile = index.find(item => item.id === id);
            if (!profile) return undefined;
            await storage.put(`profile:${key(profile.name)}`, null);
            await storage.put('profileIndex', index.filter(item => item.id !== id));
            return profile;
        }); }
    };
}
