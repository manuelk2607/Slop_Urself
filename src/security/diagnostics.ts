const knownCodes = new Set(['08001', '08006', '23505', '40001', '42501', '53300', '57014', '57P01', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']);
export type FailureStage = 'statistics' | 'persistence' | 'startup' | 'room-operation' | 'members' | 'round' | 'archive-content-status';
export function operationFailure(stage: FailureStage, error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    // Never include message/stack/query/URL: upstream errors can echo SQL values,
    // OAuth query parameters, private prompts and connection strings.
    console.error(JSON.stringify({ type: 'operation_failed', stage, errorCode: typeof code === 'string' && knownCodes.has(code) ? code : 'unclassified' }));
}
