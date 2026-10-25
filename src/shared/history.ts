export const RESTORE_BATCH_SIZE = 200;
export interface RestoreResult { id: string; status: 'restored' | 'expired' | 'not_found' | 'unavailable' | 'forbidden' }
export function restoreIds(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.length > RESTORE_BATCH_SIZE || value.some(id => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)) throw new Error('Bitte wähle höchstens 200 gültige Video-IDs aus.');
    return [...new Set(value)] as string[];
}
