import { PendingInputs, type PendingInput } from '../security/pending-input';
import { StoredModerationJournal } from '../security/moderation-journal';
import { generationSafetyReady, moderateInput, ModerationError, type ModerationConfig } from '../security/moderation';
import { buildVideoPrompt } from '../shared/video-prompt';
import { readSharedImage, type ImageStorage } from '../game/images';

interface Callbacks { current(): boolean; approved(image: string): Promise<void>; rejected(error: unknown): Promise<void>; cancelled?(): void }
type Task = { code: string; cancelled: boolean; running: boolean; closing?: boolean; input?: PendingInput; callbacks: Callbacks; timer?: ReturnType<typeof setTimeout> };
// Node games intentionally live in RAM. Persist moderation tickets/inputs, and
// explicitly discard orphaned work on startup rather than guessing a game owner.
export class NodeInputs {
    private active = new Map<string, Task>();
    private indexOperations: Promise<unknown> = Promise.resolve();
    constructor(private storage: ImageStorage, private config: ModerationConfig, private retryMs = 15_000) {}
    private scoped(code: string): ImageStorage {
        return { get: key => this.storage.get(`${code}:${key}`), put: (key, value) => this.storage.put(`${code}:${key}`, value), delete: key => this.storage.delete(`${code}:${key}`) };
    }
    private index(update: (codes: string[]) => string[]) {
        const work = this.indexOperations.then(async () => {
            const next = update(await this.storage.get<string[]>('input-index') || []);
            if (next.length > 64) throw new Error('Zu viele ausstehende Bildprüfungen.');
            await this.storage.put('input-index', next);
        });
        this.indexOperations = work.catch(() => {}); return work;
    }
    async cleanupOnStart() {
        for (const code of await this.storage.get<string[]>('input-index') || []) {
            const inputs = new PendingInputs(this.scoped(code)), input = await inputs.load();
            if (input) await inputs.remove(input);
        }
        await this.index(() => []);
    }
    has(code: string) { return this.active.has(code); }
    async submit(data: Omit<PendingInput, 'image' | 'stage' | 'expiresAt' | 'retryAt'>, image: string, callbacks: Callbacks) {
        generationSafetyReady(this.config);
        if (!/^[A-Z0-9]{4}$/.test(data.code) || this.active.has(data.code)) throw new Error('Ein Bild wird bereits geprüft.');
        const task: Task = { code: data.code, cancelled: false, running: true, callbacks };
        this.active.set(data.code, task);
        try {
            await this.index(codes => [...new Set([...codes, data.code])]);
            task.input = await new PendingInputs(this.scoped(data.code)).create(data, image);
            task.running = false;
            if (task.cancelled || !callbacks.current()) { await this.dispose(task); return; }
            void this.step(task).catch(() => this.dispose(task));
        } catch (error) { task.running = false; await this.dispose(task); throw error; }
    }
    private async finish(task: Task) {
        clearTimeout(task.timer);
        const inputs = new PendingInputs(this.scoped(task.code)), input = task.input || await inputs.load();
        if (input) await inputs.remove(input);
        await this.index(codes => codes.filter(code => code !== task.code));
        this.active.delete(task.code);
    }
    private async dispose(task: Task) {
        if (task.closing) return; task.closing = true;
        try { await this.finish(task); }
        catch { task.timer = setTimeout(() => { task.closing = false; void this.dispose(task); }, 30_000); task.timer.unref(); }
    }
    private async step(task: Task) {
        if (task.running) return; task.running = true;
        let retry = false;
        try {
            const input = task.input!;
            if (task.cancelled || !task.callbacks.current()) return;
            if (input.expiresAt <= Date.now()) throw new Error('Die Bildprüfung ist abgelaufen.');
            const storage = this.scoped(task.code), journal = new StoredModerationJournal(storage);
            const image = await readSharedImage(storage, input.image);
            await moderateInput(image, input.shared ? '' : buildVideoPrompt(input.prompt), { ...this.config, moderationJournal: journal });
            if (task.cancelled || !task.callbacks.current()) return;
            if (input.expiresAt <= Date.now()) throw new Error('Die Bildprüfung ist abgelaufen.');
            input.stage = 'starting'; await new PendingInputs(storage).save(input);
            await task.callbacks.approved(image);
        } catch (error) {
            retry = !task.cancelled && task.callbacks.current() && task.input!.expiresAt > Date.now()
                && error instanceof ModerationError && error.code === 'moderation_unavailable' && this.config.AI_GENERATION_RELEASE !== 'blocked';
            if (!retry && !task.cancelled && task.callbacks.current()) await task.callbacks.rejected(error);
        } finally {
            task.running = false;
            if (!task.callbacks.current()) task.callbacks.cancelled?.();
            if (retry) { task.timer = setTimeout(() => { void this.step(task).catch(() => this.dispose(task)); }, this.retryMs); task.timer.unref(); }
            else await this.dispose(task);
        }
    }
    sweep() {
        for (const task of this.active.values()) if (!task.callbacks.current()) {
            task.cancelled = true;
            task.callbacks.cancelled?.();
            if (!task.running) void this.dispose(task);
        }
    }
}
