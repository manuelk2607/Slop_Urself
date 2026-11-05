import { profileAuthConfig } from '../../auth/session';
import { worldsAccounts, worldsConfig } from '../../auth/worlds';
import { getSql } from '../../database/neon';
import type { PgQuery } from '../../auth/worlds-shared/postgres-links.ts';
import type { ManagedProfileStore } from '../../auth/profiles';
import { service } from './runtime';
import type { Env } from './types';

export function serviceProfiles(env: Env): ManagedProfileStore {
    return {
        create: async (name, passwordHash) => (await service(env, '/profiles/create', { name, passwordHash })).profile || undefined,
        find: async name => (await service(env, '/profiles/find', { name })).profile || undefined,
        list: async () => (await service(env, '/profiles/list')).profiles,
        remove: async id => (await service(env, '/profiles/remove', { id })).profile || undefined,
        setPassword: async (id, passwordHash) => (await service(env, '/profiles/password', { id, passwordHash })).profile || undefined
    };
}
export const cloudflareWorldsQuery = (env: Env): PgQuery => async (text, values) =>
    await getSql(env.DATABASE_URL)!.query(text, values);

export function cloudflareAuth(env: Env, profiles = serviceProfiles(env)) {
    const query = cloudflareWorldsQuery(env);
    return profileAuthConfig({
        ...env, worlds: worldsAccounts(worldsConfig(env, query), query, env.ADMIN_ACCOUNT_ID)
    }, profiles);
}
