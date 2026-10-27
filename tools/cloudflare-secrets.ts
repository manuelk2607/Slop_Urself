export const SECRET_NAMES = ['DATABASE_URL', 'AUTH_COOKIE_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
const OPTIONAL_SECRET_NAMES = ['ADMIN_ACCOUNT_ID', 'ADMIN_ACCESS_KEY', 'HF_OAUTH_CLIENT_ID', 'HF_OAUTH_ORIGIN', 'HF_OAUTH_ENCRYPTION_KEY'];
// Retired keys are never automatically re-uploaded from an old local env file.
const EXPLICIT_SECRET_NAMES = ['HF_TOKEN', 'HF_OAUTH_PREVIOUS_ENCRYPTION_KEY'];

export function prepareSecrets(env: Record<string, string | undefined>, selected: readonly string[] = []) {
    const names = selected.length ? [...new Set(selected)] : [...SECRET_NAMES, ...OPTIONAL_SECRET_NAMES.filter(name => env[name])];
    const unknown = names.filter(name => ![...SECRET_NAMES, ...OPTIONAL_SECRET_NAMES, ...EXPLICIT_SECRET_NAMES].includes(name));
    if (unknown.length) throw new Error(`Unbekannte Secrets: ${unknown.join(', ')}`);
    const missing = names.filter(name => !env[name]);
    if (missing.length) throw new Error(`Fehlende Werte in .env.local: ${missing.join(', ')}`);
    if (names.includes('AUTH_COOKIE_SECRET') && env.AUTH_COOKIE_SECRET!.length < 32) {
        throw new Error('AUTH_COOKIE_SECRET muss mindestens 32 Zeichen lang sein.');
    }
    if (names.includes('ADMIN_ACCESS_KEY') && env.ADMIN_ACCESS_KEY!.length < 32) throw new Error('ADMIN_ACCESS_KEY muss mindestens 32 Zeichen lang sein.');
    if (names.includes('HF_OAUTH_ENCRYPTION_KEY') && env.HF_OAUTH_ENCRYPTION_KEY!.length < 32) throw new Error('HF_OAUTH_ENCRYPTION_KEY muss mindestens 32 Zeichen lang sein.');
    if (names.includes('HF_OAUTH_PREVIOUS_ENCRYPTION_KEY') && (env.HF_OAUTH_PREVIOUS_ENCRYPTION_KEY!.length < 32 || !env.HF_OAUTH_ENCRYPTION_KEY || env.HF_OAUTH_ENCRYPTION_KEY.length < 32)) throw new Error('Für die Rotation sind ein aktueller und ein vorheriger HF-Schlüssel mit jeweils mindestens 32 Zeichen erforderlich.');
    return Object.fromEntries(names.map(name => [name, env[name]!]));
}
