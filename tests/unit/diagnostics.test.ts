import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operationFailure } from '../../src/security/diagnostics';
test('database and room failures never echo messages, queries, credentials or arbitrary error codes', () => {
    const original = console.error, logs: string[] = [];
    console.error = value => { logs.push(String(value)); };
    try {
        operationFailure('persistence', Object.assign(new Error('postgres://secret; prompt-private; code=oauth-secret'), { code: '08006', query: 'private SQL' }));
        operationFailure('round', { code: 'user-controlled-secret', message: 'private prompt' });
        assert.deepEqual(logs.map(line => JSON.parse(line)), [{ type: 'operation_failed', stage: 'persistence', errorCode: '08006' }, { type: 'operation_failed', stage: 'round', errorCode: 'unclassified' }]);
    } finally { console.error = original; }
});
