import type { Provider } from './providers';

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
}

export function logAiEvent(event: string, fields: AiTelemetry = {}) {
    // Explicit fields prevent prompts, upload URLs, credentials or error bodies entering logs.
    console.info(JSON.stringify({ type: 'ai', event, at: new Date().toISOString(),
        generationId: fields.generationId, roomCode: fields.roomCode, videoNumber: fields.videoNumber,
        provider: fields.provider, attempt: fields.attempt, steps: fields.steps,
        durationSeconds: fields.durationSeconds, elapsedMs: fields.elapsedMs, errorCode: fields.errorCode }));
}
