import { boundedJson } from '../server/body';
import type { ModerationJournal } from './moderation-journal';

class LostAcknowledgement extends Error {}

export async function moderationRequest(url: string, secret: string, body: string, digest: string,
    wait: (signal: AbortSignal) => Promise<void> = signal => new Promise((resolve, reject) => {
        const done = () => { signal.removeEventListener('abort', aborted); resolve(); };
        const timer = setTimeout(done, 1500);
        const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new Error('Moderation deadline')); };
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
    }), durable?: { journal: ModerationJournal; key: string }) {
    const endpoint = new URL(url), asynchronous = endpoint.pathname.endsWith('/jobs/validate');
    // The room/service command must not hold its serial operation queue for
    // five minutes. Long jobs need a durable checkpoint/resume orchestrator;
    // until that exists, an overlong check remains unavailable, never approved.
    const signal = AbortSignal.timeout(30_000);
    const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'x-content-sha256': digest, 'x-moderation-mode': 'validate' };
    const jobUrl = (id: string) => { const target = new URL(endpoint.href); target.pathname = endpoint.pathname.slice(0, -'validate'.length) + id; return target.href; };
    const request = async (target: string, method: 'GET' | 'POST') => {
        signal.throwIfAborted();
        let response: Response;
        try { response = await fetch(target, { method, redirect: 'manual', headers,
            ...(method === 'POST' ? { body } : {}), signal }); }
        catch (error) { if (method === 'POST') throw new LostAcknowledgement(); throw error; }
        if (![200, 202].includes(response.status) || !response.headers.get('content-type')?.includes('application/json')) {
            await response.body?.cancel(); throw new Error('Moderation unavailable');
        }
        return { status: response.status, value: await boundedJson(response, 16_384) };
    };
    if (durable && asynchronous) {
        let checkpoint = await durable.journal.load(durable.key);
        if (checkpoint && (checkpoint.digest !== digest || checkpoint.expiresAt <= Date.now()
            || (checkpoint.id !== undefined && !/^[a-f0-9-]{36}$/.test(checkpoint.id)))) throw new Error('Invalid stored moderation');
        let step, lookupOnly = Boolean(checkpoint && !checkpoint.id);
        if (checkpoint) step = await request(jobUrl(checkpoint.id || 'lookup'), 'GET');
        else {
            checkpoint = { digest, expiresAt: Date.now() + 360_000 };
            // Persist intent before network I/O. After eviction, lookup the same
            // digest instead of repeating an uncertain POST.
            await durable.journal.save(durable.key, checkpoint);
            try { step = await request(url, 'POST'); }
            catch (error) { if (!(error instanceof LostAcknowledgement)) throw error; lookupOnly = true; step = await request(jobUrl('lookup'), 'GET'); }
        }
        if (step.status === 200) {
            if (lookupOnly) throw new Error('Invalid moderation lookup');
            await durable.journal.clear(durable.key); return step.value;
        }
        const value = step.value as { id?: unknown; digest?: unknown; status?: unknown; evaluationOnly?: unknown } | null;
        if (!value || value.digest !== digest || value.evaluationOnly !== undefined || (value.status !== undefined && value.status !== 'pending')) throw new Error('Invalid pending moderation');
        if (!checkpoint.id) {
            if (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)) throw new Error('Invalid moderation ticket');
            checkpoint.id = value.id; await durable.journal.save(durable.key, checkpoint);
        }
        throw new Error('Moderation pending');
    }
    let response;
    try { response = await request(url, 'POST'); }
    catch (error) {
        if (!asynchronous || !(error instanceof LostAcknowledgement)) throw error;
        const lookup = new URL(endpoint.href); lookup.pathname = endpoint.pathname.slice(0, -'validate'.length) + 'lookup';
        // Recover a persisted acknowledgement by digest; never create a second job.
        response = await request(lookup.href, 'GET');
        if (response.status !== 202) throw new Error('Invalid moderation lookup');
    }
    if (response.status === 200) return response.value;
    if (!asynchronous) throw new Error('Unexpected pending moderation');
    const ticket = response.value as { id?: unknown; digest?: unknown; evaluationOnly?: unknown } | null;
    if (!ticket || typeof ticket.id !== 'string' || !/^[a-f0-9-]{36}$/.test(ticket.id)
        || ticket.digest !== digest || ticket.evaluationOnly !== undefined) throw new Error('Invalid moderation job');
    // Never accept a server-provided URL. A lost job fails closed without a new POST.
    const poll = new URL(endpoint.href); poll.pathname = endpoint.pathname.slice(0, -'validate'.length) + ticket.id;
    for (;;) {
        await wait(signal);
        response = await request(poll.href, 'GET');
        if (response.status === 200) return response.value;
        const pending = response.value as { digest?: unknown; status?: unknown } | null;
        if (!pending || pending.digest !== digest || pending.status !== 'pending') throw new Error('Invalid moderation status');
    }
}
