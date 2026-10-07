import { sqlProfiles, storedProfiles, type Profile, type ProfileStore } from '../../auth/profiles';
import { getSql } from '../../database/neon';
import { QuotaBudget } from '../../ai/quota';
import { archiveVideo, listArchive, archiveEnabled, archiveLimit } from '../../storage/archive';
import { takeRateLimit, type RateBuckets, type RateRule } from '../../security/rate-limit';
import { json } from './runtime';
import type { DurableObjectState, Env } from './types';

export class ServiceDurableObject {
    private quotaOperations: Promise<unknown> = Promise.resolve();
    private archiveOperations: Promise<unknown> = Promise.resolve();
    private profileOperations: Promise<unknown> = Promise.resolve();
    private securityOperations: Promise<unknown> = Promise.resolve();
    private profiles: ProfileStore;
    private budget: QuotaBudget;
    constructor(private state: DurableObjectState, private env: Env) {
        this.budget = new QuotaBudget(state.storage, env);
        this.profiles = env.DATABASE_URL ? sqlProfiles(async (sql, values) => await getSql(env.DATABASE_URL)!.query(sql, values) as Profile[]) : storedProfiles(state.storage);
    }
    async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        const action = async () => {
            const data = await request.json() as { code: string; rounds: number; players?: number; generations: number; seconds: number; jobId?: string; url: string; name: string; key: string; rule: RateRule };
            if (path === '/security/rate') {
                const buckets = await this.state.storage.get<RateBuckets>('rateBuckets') || {};
                const retryAfter = takeRateLimit(buckets, data.key, data.rule);
                await this.state.storage.put('rateBuckets', buckets);
                return json({ retryAfter });
            }
            if (path === '/quota/display') return json(await this.budget.displayCapacity(data.players));
            if (path === '/quota/capacity') return json(await this.budget.capacity(data.players));
            if (path === '/quota/reserve') await this.budget.reserve(data.code, data.rounds, data.players);
            else if (path === '/quota/extend') await this.budget.extend(data.code, data.players!);
            else if (path === '/quota/begin') await this.budget.begin(data.code, data.generations, data.jobId);
            else if (path === '/quota/consume') await this.budget.consume(data.code, data.jobId);
            else if (path === '/quota/release') await this.budget.release(data.code);
            else if (path === '/quota/drop') await this.budget.drop(data.code, data.generations);
            else if (path === '/quota/attempt') await this.budget.allowAttempt(data.code, data.seconds, data.jobId);
            else if (path === '/archive') return json({ url: await archiveVideo(data.url, this.env) });
            else if (path === '/archive/status') { const objects = await listArchive(this.env); return json({ enabled: archiveEnabled(this.env), usedBytes: objects.reduce((sum, item) => sum + item.size, 0), maxBytes: archiveLimit(this.env), videoCount: objects.length }); }
            else if (path === '/profiles/create') return json({ profile: await this.profiles.create(data.name) || null });
            else if (path === '/profiles/find') return json({ profile: await this.profiles.find(data.name) || null });
            return json({ ok: true });
        };
        const result = (path.startsWith('/security/') ? this.securityOperations : path.startsWith('/quota/') ? this.quotaOperations : path.startsWith('/profiles/') ? this.profileOperations : this.archiveOperations).then(action).catch(error => json({ error: error instanceof Error ? error.message : 'Dienst nicht erreichbar.' }, { status: 503 }));
        if (path.startsWith('/security/')) this.securityOperations = result;
        else if (path.startsWith('/quota/')) this.quotaOperations = result;
        else if (path.startsWith('/profiles/')) this.profileOperations = result;
        else this.archiveOperations = result;
        return result;
    }
}
