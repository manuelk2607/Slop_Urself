import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSecrets } from '../../tools/cloudflare-secrets';

test('admin setup uploads both optional secrets only when configured and never accepts a short key', () => {
    const env = { ADMIN_ACCOUNT_ID: 'owner-id', ADMIN_ACCESS_KEY: 'unit-admin-key-at-least-32-characters' };
    assert.deepEqual(prepareSecrets(env, ['ADMIN_ACCOUNT_ID', 'ADMIN_ACCESS_KEY']), env);
    assert.throws(() => prepareSecrets({ ...env, ADMIN_ACCESS_KEY: 'short' }, ['ADMIN_ACCESS_KEY']), /mindestens 32/);
    assert.throws(() => prepareSecrets({ ADMIN_ACCOUNT_ID: 'owner-id' }, ['ADMIN_ACCOUNT_ID', 'ADMIN_ACCESS_KEY']), /ADMIN_ACCESS_KEY/);
});

test('Cloudflare secret setup validates required values without revealing their contents', () => {
    const env = { HF_TOKEN: 'private-hf-token', DATABASE_URL: 'private-database-url',
        AUTH_COOKIE_SECRET: 'test-only-cookie-secret-at-least-32-characters',
        AWS_ACCESS_KEY_ID: 'private-access-key', AWS_SECRET_ACCESS_KEY: 'private-storage-secret' };
    const { HF_TOKEN, ...required } = env;
    assert.deepEqual(prepareSecrets(env), required);
    assert.deepEqual(prepareSecrets(required), required);
    assert.throws(() => prepareSecrets({ HF_TOKEN: env.HF_TOKEN }), {
        message: 'Fehlende Werte in .env.local: DATABASE_URL, AUTH_COOKIE_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY'
    });
    assert.throws(() => prepareSecrets({ ...env, AUTH_COOKIE_SECRET: 'x'.repeat(31) }), {
        message: 'AUTH_COOKIE_SECRET muss mindestens 32 Zeichen lang sein.'
    });
    assert.equal(prepareSecrets({ ...env, AUTH_COOKIE_SECRET: 'x'.repeat(32) }).AUTH_COOKIE_SECRET.length, 32);
});

test('Targeted secret setup only uploads selected secrets and rejects unknown names', () => {
    const key = 'test-only-cookie-secret-at-least-32-characters';
    assert.deepEqual(prepareSecrets({ AUTH_COOKIE_SECRET: key }, ['AUTH_COOKIE_SECRET', 'AUTH_COOKIE_SECRET']), { AUTH_COOKIE_SECRET: key });
    assert.deepEqual(prepareSecrets({ HF_TOKEN: 'test-token' }, ['HF_TOKEN']), { HF_TOKEN: 'test-token' });
    assert.throws(() => prepareSecrets({ AUTH_COOKIE_SECRET: key }, ['AUTH_COOKIE_SECRET_TYPO']), { message: 'Unbekannte Secrets: AUTH_COOKIE_SECRET_TYPO' });
    assert.throws(() => prepareSecrets({}, ['AUTH_COOKIE_SECRET']), { message: 'Fehlende Werte in .env.local: AUTH_COOKIE_SECRET' });
});

test('retired vault keys require explicit selection and valid current/previous secrets', () => {
    const current = 'current-test-vault-key-at-least-32-characters', previous = 'previous-test-vault-key-at-least-32-characters';
    const env = { DATABASE_URL: 'fixture', AUTH_COOKIE_SECRET: current, AWS_ACCESS_KEY_ID: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture',
        HF_OAUTH_ENCRYPTION_KEY: current, HF_OAUTH_PREVIOUS_ENCRYPTION_KEY: previous };
    assert.equal('HF_OAUTH_PREVIOUS_ENCRYPTION_KEY' in prepareSecrets(env), false);
    assert.deepEqual(prepareSecrets(env, ['HF_OAUTH_PREVIOUS_ENCRYPTION_KEY']), { HF_OAUTH_PREVIOUS_ENCRYPTION_KEY: previous });
    for (const change of [{ HF_OAUTH_ENCRYPTION_KEY: '' }, { HF_OAUTH_PREVIOUS_ENCRYPTION_KEY: 'short' }]) {
        assert.throws(() => prepareSecrets({ ...env, ...change }, ['HF_OAUTH_PREVIOUS_ENCRYPTION_KEY']), /mindestens 32/);
    }
});
