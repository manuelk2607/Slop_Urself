// Version the complete KDF contract. Keep the existing Worker-compatible work
// factor; a new cost/algorithm needs its own version and runtime validation.
const current = { tag: 'pbkdf2-sha256-v1', iterations: 100_000 } as const;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, pair => parseInt(pair, 16));
export function validPassword(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 12 && value.length <= 200;
}
async function derive(password: string, salt: Uint8Array) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations: current.iterations }, key, 256));
}
export async function hashPassword(password: string) {
    if (!validPassword(password)) throw new Error('Das Passwort muss 12 bis 200 Zeichen lang sein.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `${current.tag}$${current.iterations}$${hex(salt)}$${hex(await derive(password, salt))}`;
}
export async function checkPassword(password: unknown, encoded: unknown) {
    // The legacy tag remains readable. Never derive an attacker-supplied work
    // factor, algorithm or unknown version from an unvalidated stored value.
    if (!validPassword(password) || typeof encoded !== 'string' || !/^pbkdf2-sha256(?:-v1)?\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded)) return false;
    const [, , salt, hash] = encoded.split('$');
    const actual = await derive(password, bytes(salt)), expected = bytes(hash);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
}
