import { profileAuthConfig } from '../../auth/session';
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
export const cloudflareAuth = (env: Env) => profileAuthConfig(env, serviceProfiles(env));
