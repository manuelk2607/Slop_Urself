import { AiPendingError, AI_JOB_MAX_AGE_MS, type AiJob } from './generation';
import { ModerationError } from '../security/moderation';

export function archiveRecovery(error: unknown, job?: AiJob, now = Date.now()) {
    if (job?.status === 'complete' && job.videoUrl && now - job.submittedAt < AI_JOB_MAX_AGE_MS
        && !(error instanceof ModerationError && error.code !== 'moderation_unavailable')) return new AiPendingError(job);
    return error;
}
