import { storedProfiles } from '../../src/auth/profiles';

process.env.PORT = process.env.PORT || '3340';
process.env.AUTH_MODE = '';
process.env.AI_PROVIDER = 'mock';
process.env.DATABASE_URL = '';
process.env.ADMIN_ACCOUNT_ID = 'admin-owner-id';
process.env.ADMIN_ACCESS_KEY = 'ci-private-admin-key-not-used-in-production';
process.env.AUTH_COOKIE_SECRET = 'ci-session-signing-key-not-used-in-production';
const data = new Map<string, unknown>([
    ['profile:manuel', { id: 'admin-owner-id', name: 'Manuel' }],
    ['profile:friend', { id: 'admin-friend-id', name: 'Friend' }],
    ['profileIndex', [{ id: 'admin-owner-id', name: 'Manuel' }, { id: 'admin-friend-id', name: 'Friend' }]]
]);
const profiles = storedProfiles({ get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async (key, value) => { data.set(key, structuredClone(value)); } });
require('../../dist/database/node.js').getProfiles = () => profiles;
require('../../dist/server/node.js');
