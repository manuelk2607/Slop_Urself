import type { Provider } from './providers';
import { releaseId } from '../security/release';

export interface AiTelemetry {
    generationId?: string;
    roomCode?: string;
    videoNumber?: number;
    provider?: Provider;
    attempt?: number;
    steps?: number;
    durationSeconds?: number;
    elapsedMs?: number;
    errorCode?: string;
    stage?: 'quota' | 'metadata' | 'configuration' | 'upload' | 'submit' | 'result' | 'download' | 'output_moderation' | 'inventory' | 'archive';
    releaseId?: string;
    httpStatus?: number;
}

export function logAiEvent(event: string, fields: AiTelemetry = {}) {
    // Explicit fields prevent prompts, upload URLs, credentials or error bodies entering logs.
    console.info(JSON.stringify({ type: 'ai', event, at: new Date().toISOString(),
        generationId: fields.generationId, roomCode: fields.roomCode, videoNumber: fields.videoNumber,
        provider: fields.provider, attempt: fields.attempt, steps: fields.steps,
        durationSeconds: fields.durationSeconds, elapsedMs: fields.elapsedMs, errorCode: fields.errorCode,
        stage: fields.stage, httpStatus: fields.httpStatus, releaseId: releaseId(fields.releaseId) }));
}
