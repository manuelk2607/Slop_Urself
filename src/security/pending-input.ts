import { deleteSharedImage, writeSharedImage, type ImageStorage, type SharedImage } from '../game/images';

export interface PendingInput {
    shared?: boolean; roomPhase?: string;
    id: string; code: string; creatorId: string; accountId: string; ballotId?: string;
    prompt: string; image: SharedImage; expiresAt: number; retryAt: number;
    stage: 'staging' | 'checking' | 'starting';
}
export class PendingInputs {
    constructor(private storage: ImageStorage) {}
    load() { return this.storage.get<PendingInput>('pendingInput'); }
    async create(data: Omit<PendingInput, 'image' | 'stage' | 'expiresAt' | 'retryAt'>, image: string) {
        if (await this.load()) throw new Error('Ein Bild wird bereits geprüft.');
        let pending: PendingInput | undefined;
        try {
            await writeSharedImage(this.storage, image, undefined, async meta => {
                meta.expiresAt = Date.now() + 360_000;
                pending = { ...data, image: meta, expiresAt: meta.expiresAt, retryAt: Date.now(), stage: 'staging' };
                // Intent precedes every chunk, so interrupted uploads remain discoverable.
                await this.storage.put('pendingInput', pending);
            });
            pending!.stage = 'checking'; await this.save(pending!); return pending!;
        } catch (error) { if (pending) await this.remove(pending); throw error; }
    }
    save(value: PendingInput) { return this.storage.put('pendingInput', value); }
    async remove(value: PendingInput, keepImage = false) {
        if ((await this.load())?.id !== value.id) return;
        if (!keepImage) await deleteSharedImage(this.storage, value.image);
        await this.storage.delete('moderation-checkpoints');
        await this.storage.delete('pendingInput');
    }
}
