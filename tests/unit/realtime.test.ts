import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeClient } from '../../src/client/realtime';

test('native reconnect remains available after leaving a room with a pending reconnect', async () => {
    const timers = new Map<number, () => void>();
    const sockets: TestSocket[] = [];
    let nextTimer = 0, room = 'ABCD';
    class TestSocket extends EventTarget {
        static OPEN = 1;
        static CONNECTING = 0;
        readyState = 0;
        constructor(public url: string) { super(); sockets.push(this); }
        close() { this.readyState = 3; this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 })); }
        connected() {
            this.readyState = TestSocket.OPEN;
            this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ type: 'connect', payload: { socketId: 'test' } }) }));
        }
    }
    const replacements = {
        window: { addEventListener() {}, setTimeout(callback: () => void) { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout(id: number) { timers.delete(id); } },
        location: { protocol: 'https:', host: 'game.example' }, WebSocket: TestSocket
    };
    const previous = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    try {
        const client = createRealtimeClient(() => room);
        let connection = client.connectToRoom(room); sockets[0].connected(); await connection;
        sockets[0].close(); assert.equal(timers.size, 1);
        client.disconnectFromRoom(); assert.equal(timers.size, 0);
        room = 'EFGH'; connection = client.connectToRoom(room); sockets[1].connected(); await connection;
        sockets[1].close(); assert.equal(timers.size, 1, 'The cancelled old timer must not block a new reconnect.');
        const [id, reconnect] = [...timers][0]; timers.delete(id); reconnect();
        assert.equal(sockets[2].url, 'wss://game.example/ws/EFGH');
        sockets[2].connected(); await Promise.resolve();
        assert.equal(client.id, 'test'); client.disconnectFromRoom(); assert.equal(timers.size, 0);
    } finally {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
