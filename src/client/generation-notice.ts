import { generationMessage, generationElapsed, type GenerationView } from '../shared/generation';

export function generationNotice(target: HTMLElement, clock: HTMLElement) {
    let current: GenerationView | undefined, timer: number | undefined;
    let serverTime = 0, receivedAt = 0;
    const render = () => { if (current) clock.textContent = generationElapsed(current, serverTime + performance.now() - receivedAt); };
    return {
        get id() { return current?.id; },
        update(value: GenerationView | undefined, time: number) {
            if (!value || typeof value.id !== 'string' || !Number.isFinite(value.startedAt) || !Number.isFinite(time)) return;
            const message = generationMessage(value);
            // Announce stage changes, not a new live-region message every second.
            if (target.textContent !== message) target.textContent = message;
            current = value; serverTime = time; receivedAt = performance.now(); render();
            timer ??= window.setInterval(render, 1000);
        },
        stop() { window.clearInterval(timer); timer = undefined; current = undefined; clock.textContent = ''; }
    };
}
