import type { Account, AuthConfig } from '../../auth/session';
import type { AiConfig } from '../../ai/generation';
import type { QuotaConfig } from '../../ai/quota';
import type { ArchiveConfig } from '../../storage/archive';
import type { Room } from '../../game/rules';
import type { RoomDurableObject } from './room';
import type { ServiceDurableObject } from './services';

interface Fetcher { fetch(request: Request): Promise<Response> }
interface DurableObjectId {}
interface DurableObjectNamespace<T> {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}
export interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
}
export interface DurableObjectState {
    storage: DurableObjectStorage;
    acceptWebSocket(socket: CloudflareWebSocket): void;
    getWebSockets(): CloudflareWebSocket[];
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
    waitUntil(promise: Promise<unknown>): void;
}
export interface CloudflareWebSocket extends WebSocket {
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): ConnectionMeta;
}
export interface Env extends AuthConfig, QuotaConfig, ArchiveConfig, AiConfig {
    ASSETS: Fetcher;
    ROOMS: DurableObjectNamespace<RoomDurableObject>;
    SERVICES?: DurableObjectNamespace<ServiceDurableObject>;
    DATABASE_URL?: string;
}
export interface ConnectionMeta { socketId: string; sessionId?: string; playerId?: string; account?: Account }
export type PendingRoomWrite = Room & { writeAction?: 'continue' };
