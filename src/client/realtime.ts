type SocketEventHandler = (data?: any) => void;
export type SocketPayload = Record<string, unknown>;
type SocketFactory = (options?: Record<string, unknown>) => any;

interface SlopWindow extends Window {
    io?: SocketFactory;
}

export interface RealtimeClient {
    readonly id: string;
    readonly isNativeWebSocket: boolean;
    on(event: string, handler: SocketEventHandler): void;
    emit(event: string, payload?: SocketPayload): void;
    connectToRoom(roomId: string): Promise<void>;
    disconnectFromRoom(): void;
}

class SocketIoRealtimeClient implements RealtimeClient {
    readonly isNativeWebSocket = false;

    constructor(private readonly socketIoClient: any) {}

    get id() {
        return this.socketIoClient.id || '';
    }

    on(event: string, handler: SocketEventHandler) {
        this.socketIoClient.on(event, handler);
    }

    emit(event: string, payload?: SocketPayload) {
        this.socketIoClient.emit(event, payload);
    }

    async connectToRoom() {
        if (this.socketIoClient.connected) return;
        await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('Verbindung hat zu lange gedauert.')), 8000);
            this.socketIoClient.once('connect', () => { window.clearTimeout(timer); resolve(); });
            this.socketIoClient.once('connect_error', () => { window.clearTimeout(timer); reject(new Error('Bitte melde dich erneut an.')); });
            this.socketIoClient.connect();
        });
    }
    disconnectFromRoom() { this.socketIoClient.disconnect(); }
}

class NativeWebSocketRealtimeClient implements RealtimeClient {
    readonly isNativeWebSocket = true;
    private socket: WebSocket | null = null;
    private socketId = '';
    private activeRoomId = '';
    private openPromise: Promise<void> | null = null;
    private reconnectTimer: number | undefined;
    private reconnectAttempts = 0;
    private readonly handlers = new Map<string, SocketEventHandler[]>();

    constructor(private readonly currentRoom: () => string) { window.addEventListener('offline', () => this.socket?.close(1000, 'Offline')); }

    get id() { return this.socketId; }
    on(event: string, handler: SocketEventHandler) {
        this.handlers.set(event, [...(this.handlers.get(event) || []), handler]);
    }
    emit(event: string, payload?: SocketPayload) {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: event, payload }));
        else this.dispatch('errorMsg', 'Verbindung unterbrochen. Bitte warte auf die Wiederverbindung.');
    }
    disconnectFromRoom() {
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.activeRoomId = '';
        const old = this.socket;
        this.socket = null;
        this.socketId = '';
        this.openPromise = null;
        old?.close();
    }
    async connectToRoom(roomId: string) {
        if (!/^[a-z0-9]{4}$/i.test(roomId)) throw new Error('Bitte gib einen 4-stelligen Raumcode ein.');
        const code = roomId.toUpperCase();
        if (this.socket && this.activeRoomId === code && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            await this.openPromise; return;
        }
        this.disconnectFromRoom();
        this.activeRoomId = code;
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const target = new WebSocket(`${protocol}://${location.host}/ws/${code}`);
        this.socket = target;
        this.openPromise = new Promise<void>((resolve, reject) => {
            let connected = false;
            const timeout = window.setTimeout(() => { reject(new Error('Verbindung zum Raum hat zu lange gedauert.')); target.close(); }, 8000);
            target.addEventListener('message', event => {
                if (this.socket !== target) return;
                try {
                    const message = JSON.parse(String(event.data));
                    if (message.type === 'connect') {
                        this.socketId = message.payload.socketId;
                        this.reconnectAttempts = 0;
                        connected = true;
                        window.clearTimeout(timeout);
                        resolve();
                    }
                    this.dispatch(message.type, message.payload);
                } catch { this.dispatch('errorMsg', 'Ungültige Server-Antwort.'); }
            });
            target.addEventListener('error', () => {
                window.clearTimeout(timeout);
                reject(new Error('Verbindung zum Spielraum fehlgeschlagen.'));
            }, { once: true });
            target.addEventListener('close', event => {
                window.clearTimeout(timeout);
                if (this.socket !== target) return;
                this.socket = null;
                if (!connected) reject(new Error('Verbindung zum Spielraum wurde geschlossen.'));
                if (event.code === 4001) { this.activeRoomId = ''; this.dispatch('sessionReplaced'); return; }
                this.dispatch('disconnect');
                if (this.activeRoomId && this.currentRoom() === this.activeRoomId) this.scheduleReconnect();
            });
        });
        await this.openPromise;
    }
    private scheduleReconnect() {
        if (this.reconnectTimer) return;
        const roomId = this.activeRoomId;
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this.currentRoom() !== roomId) return;
            void this.connectToRoom(roomId).catch(() => {
                if (this.currentRoom() === roomId) { this.activeRoomId = roomId; this.scheduleReconnect(); }
            });
        }, Math.min(1000 * 2 ** this.reconnectAttempts++, 5000));
    }
    private dispatch(event: string, payload?: any) {
        (this.handlers.get(event) || []).forEach(handler => handler(payload));
    }
}


export function createRealtimeClient(currentRoom: () => string): RealtimeClient {
    const io = (window as SlopWindow).io;
    return io ? new SocketIoRealtimeClient(io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true }))
        : new NativeWebSocketRealtimeClient(currentRoom);
}
