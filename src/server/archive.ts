import type { GameRepository } from '../database/repository';
import { archiveEnabled, archiveLimit, listArchive, type ArchiveConfig } from '../storage/archive';

export async function archiveStatus(config: ArchiveConfig, database: GameRepository | null) {
    const enabled = archiveEnabled(config);
    const objects = await listArchive(config);
    if (enabled) await database?.reconcileArchive(objects.map(object => `/api/videos/${object.key}`));
    return { enabled, usedBytes: objects.reduce((sum, object) => sum + object.size, 0),
        maxBytes: archiveLimit(config), videoCount: objects.length };
}
