import { boundedJson } from '../server/body';

export async function moderationRequest(url: string, secret: string, body: string, digest: string,
    wait: (signal: AbortSignal) => Promise<void> = signal => new Promise((resolve, reject) => {
        const done = () => { signal.removeEventListener('abort', aborted); resolve(); };
        const timer = setTimeout(done, 1500);
        const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new Error('Moderation deadline')); };
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
    })) {
    const endpoint = new URL(url), asynchronous = endpoint.pathname.endsWith('/jobs/validate');
    // The room/service command must not hold its serial operation queue for
    // five minutes. Long jobs need a durable checkpoint/resume orchestrator;
    // until that exists, an overlong check remains unavailable, never approved.
    const signal = AbortSignal.timeout(30_000);
    const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'x-content-sha256': digest };
    const request = async (target: string, method: 'GET' | 'POST') => {
        signal.throwIfAborted();
        const response = await fetch(target, { method, redirect: 'manual', headers,
            ...(method === 'POST' ? { body } : {}), signal });
        if (![200, 202].includes(response.status) || !response.headers.get('content-type')?.includes('application/json')) {
            await response.body?.cancel(); throw new Error('Moderation unavailable');
        }
        return { status: response.status, value: await boundedJson(response, 16_384) };
    };
    let response = await request(url, 'POST');
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
