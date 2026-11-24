import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rememberWorldsInvitation, roomInvitation, takeWorldsInvitation } from '../../src/client/room-invitation';

function tab() {
    const values = new Map<string, string>();
    return {
        setItem: (key: string, value: string) => values.set(key, value),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
    };
}

test('a Worlds login preserves the four-character room invitation in the same tab once', () => {
    const storage = tab();
    assert.equal(roomInvitation('?room=ab12'), 'AB12');
    rememberWorldsInvitation(storage, '?room=ab12', 1000);
    assert.equal(takeWorldsInvitation(tab(), 1001), '');
    assert.equal(takeWorldsInvitation(storage, 1001), 'AB12');
    assert.equal(takeWorldsInvitation(storage, 1001), '');
});

test('invalid, expired and future invitation data cannot return an old room', () => {
    const storage = tab();
    for (const search of ['', '?room=ABC', '?room=ABCDE', '?room=AB12%0A', '?room=%2F%2Fforeign.test']) {
        rememberWorldsInvitation(storage, search, 1000);
        assert.equal(takeWorldsInvitation(storage, 1001), '');
    }
    rememberWorldsInvitation(storage, '?room=AB12', 1000);
    assert.equal(takeWorldsInvitation(storage, 1000 + 15 * 60_000), '');
    rememberWorldsInvitation(storage, '?room=AB12', 1000);
    assert.equal(takeWorldsInvitation(storage, 999), '');
});
