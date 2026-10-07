const SECRET_NAMES = ['HF_TOKEN', 'DATABASE_URL', 'AUTH_COOKIE_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

export function prepareSecrets(env: Record<string, string | undefined>, selected: readonly string[] = []) {
    const names = selected.length ? [...new Set(selected)] : SECRET_NAMES;
    const unknown = names.filter(name => !SECRET_NAMES.includes(name));
    if (unknown.length) throw new Error(`Unbekannte Secrets: ${unknown.join(', ')}`);
    const missing = names.filter(name => !env[name]);
    if (missing.length) throw new Error(`Fehlende Werte in .env.local: ${missing.join(', ')}`);
    if (names.includes('AUTH_COOKIE_SECRET') && env.AUTH_COOKIE_SECRET!.length < 32) {
        throw new Error('AUTH_COOKIE_SECRET muss mindestens 32 Zeichen lang sein.');
    }
    return Object.fromEntries(names.map(name => [name, env[name]!]));
}
