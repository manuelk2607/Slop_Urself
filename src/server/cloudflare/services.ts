import { sqlProfiles, storedProfiles, type Profile, type ManagedProfileStore } from '../../auth/profiles';
import { getSql, getDatabase } from '../../database/neon';
import { purgeDeletedVideos, deleteStoredHistory, HistoryError, type HistoryDeletion } from '../statistics';
import { QuotaBudget } from '../../ai/quota';
import { archiveVideo, deleteArchivedVideo } from '../../storage/archive';
import { archiveStatus } from '../archive';
import { takeRateLimit, type RateBuckets, type RateRule } from '../../security/rate-limit';
import { json } from './runtime';
import type { DurableObjectState, Env } from './types';

export class ServiceDurableObject {
    private quotaOperations: Promise<unknown> = Promise.resolve();
    private archiveOperations: Promise<unknown> = Promise.resolve();
    private profileOperations: Promise<unknown> = Promise.resolve();
    private securityOperations: Promise<unknown> = Promise.resolve();
    private profiles: ManagedProfileStore;
    private budget: QuotaBudget;
    constructor(private state: DurableObjectState, private env: Env) {
        this.budget = new QuotaBudget(state.storage, env);
        this.profiles = env.DATABASE_URL ? sqlProfiles(async (sql, values) => await getSql(env.DATABASE_URL)!.query(sql, values) as Profile[]) : storedProfiles(state.storage);
    }
    async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        const action = async () => {
            const data = await request.json() as { code: string; rounds: number; players?: number; generations: number; seconds: number; jobId?: string; url: string; name: string; id: string; key: string; rule: RateRule; time: number; command: HistoryDeletion };
            if (path === '/video-trash/schedule') {
                await this.scheduleCleanup(data.time);
                return json({ ok: true });
            }
            if (path === '/video-trash/delete') return json(await deleteStoredHistory(getDatabase(this.env.DATABASE_URL), data.command, time => this.scheduleCleanup(time)));
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
            else if (path === '/archive') {
                const database = getDatabase(this.env.DATABASE_URL);
                return json({ url: await archiveVideo(data.url, this.env, await database?.protectedVideoUrls() || [],
                    database ? urls => database.reconcileArchive(urls) : undefined) });
            }
            else if (path === '/archive/delete') await deleteArchivedVideo(data.url, this.env);
            else if (path === '/archive/status') return json(await archiveStatus(this.env, getDatabase(this.env.DATABASE_URL)));
            else if (path === '/profiles/create') return json({ profile: await this.profiles.create(data.name) || null });
            else if (path === '/profiles/find') return json({ profile: await this.profiles.find(data.name) || null });
            else if (path === '/profiles/list') return json({ profiles: await this.profiles.list() });
            else if (path === '/profiles/remove') return json({ profile: await this.profiles.remove(data.id) || null });
            return json({ ok: true });
        };
        const result = (path.startsWith('/security/') ? this.securityOperations : path.startsWith('/quota/') ? this.quotaOperations : path.startsWith('/profiles/') ? this.profileOperations : this.archiveOperations).then(action).catch(error => json({ error: error instanceof Error ? error.message : 'Dienst nicht erreichbar.' }, { status: error instanceof HistoryError ? error.status : 503 }));
        if (path.startsWith('/security/')) this.securityOperations = result;
        else if (path.startsWith('/quota/')) this.quotaOperations = result;
        else if (path.startsWith('/profiles/')) this.profileOperations = result;
        else this.archiveOperations = result;
        return result;
    }

    private async scheduleCleanup(time: number) {
        const alarm = await this.state.storage.getAlarm();
        if (alarm === null || alarm > time) await this.state.storage.setAlarm(time);
    }

    async alarm() {
        const result = this.archiveOperations.then(async () => {
            const database = getDatabase(this.env.DATABASE_URL);
            await purgeDeletedVideos(database, url => deleteArchivedVideo(url, this.env));
            const next = await database?.nextVideoDeletion();
            if (next !== undefined) await this.state.storage.setAlarm(Math.max(Date.now() + 100, next));
        }).catch(async () => { await this.state.storage.setAlarm(Date.now() + 30_000); });
        this.archiveOperations = result;
        await result;
    }
}
