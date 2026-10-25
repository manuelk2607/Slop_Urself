import { sqlProfiles, storedProfiles, type Profile, type ManagedProfileStore } from '../../auth/profiles';
import { getSql, getDatabase } from '../../database/neon';
import { purgeDeletedVideos, deleteStoredHistory, HistoryError, type HistoryDeletion } from '../statistics';
import { PlayerQuotaBudget, type BudgetPlayer } from '../../ai/player-quota';
import { HfConnections, HfOAuthError, HfRequiredError, requirePlayerHf } from '../../auth/huggingface';
import { profileAuthConfig, type Account } from '../../auth/session';
import { generationQuality } from '../../ai/providers';
import { archiveVideo, deleteArchivedVideo } from '../../storage/archive';
import { archiveStatus } from '../archive';
import { takeRateLimit, type RateBuckets, type RateRule } from '../../security/rate-limit';
import { json } from './runtime';
import type { DurableObjectState, Env } from './types';
import { restoreIds } from '../../shared/history';

export class ServiceDurableObject {
    private quotaOperations: Promise<unknown> = Promise.resolve();
    private archiveOperations: Promise<unknown> = Promise.resolve();
    private profileOperations: Promise<unknown> = Promise.resolve();
    private securityOperations: Promise<unknown> = Promise.resolve();
    private alarmOperations: Promise<unknown> = Promise.resolve();
    private profiles: ManagedProfileStore;
    private budget: PlayerQuotaBudget;
    private hf: HfConnections;
    constructor(private state: DurableObjectState, private env: Env) {
        this.profiles = env.DATABASE_URL ? sqlProfiles(async (sql, values) => await getSql(env.DATABASE_URL)!.query(sql, values) as Profile[]) : storedProfiles(state.storage);
        this.hf = new HfConnections(state.storage, profileAuthConfig(env, this.profiles));
        this.budget = new PlayerQuotaBudget(state.storage, env, this.hf);
    }
    async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        const action = async () => {
            const data = await request.json() as { code: string; rounds: number; players?: number; quality?: unknown; generations: number; seconds: number; jobId?: string; url: string; name: string; id: string; key: string; rule: RateRule; time: number; command: HistoryDeletion;
                participants?: BudgetPlayer[]; participant?: BudgetPlayer; playerId?: string; ownRemaining?: number;
                account: Account; accountId: string; connection?: string; state?: string; nonce?: string; origin: string; passwordHash?: string; ids?: unknown };
            const quality = generationQuality(data.quality);
            if (path === '/hf/start') { const result = await this.hf.start(data.account, data.origin); await this.scheduleCleanup(Date.now() + 600_000); return json(result); }
            if (path === '/hf/device/start') { const result = await this.hf.startDevice(data.account, data.origin, data.nonce); await this.scheduleCleanup(result.expiresAt); return json(result); }
            if (path === '/hf/device/status') return json(await this.hf.deviceStatus(data.nonce, data.accountId, data.origin));
            if (path === '/hf/device/poll') {
                const result = await this.hf.pollDevice(data.nonce, data.account, data.origin);
                if ('connected' in result && result.connected) await this.scheduleCleanup(result.expiresAt);
                return json(result);
            }
            if (path === '/hf/device/cancel') { await this.hf.cancelDevice(data.nonce, data.accountId, data.origin); return json({ ok: true }); }
            if (path === '/hf/finish') { const result = await this.hf.finish(data.state, data.code, data.nonce, data.origin); await this.scheduleCleanup(result.expiresAt); return json(result); }
            if (path === '/hf/status') return json(await this.hf.status(data.connection, data.accountId));
            if (path === '/hf/identity') return json({ verified: await this.hf.identityMatches(data.connection, data.accountId) });
            if (path === '/hf/require') { await requirePlayerHf(this.env, data.account, this.hf); return json({ ok: true }); }
            if (path === '/hf/disconnect') { await this.hf.disconnect(data.connection, data.accountId); return json({ ok: true }); }
            if (path === '/video-trash/schedule') {
                await this.scheduleCleanup(data.time);
                return json({ ok: true });
            }
            if (path === '/video-trash/delete') return json(await deleteStoredHistory(getDatabase(this.env.DATABASE_URL), data.command, time => this.scheduleCleanup(time)));
            if (path === '/video-trash/restore') {
                const database = getDatabase(this.env.DATABASE_URL);
                if (!database) throw new HistoryError('Die Statistik-Datenbank ist nicht eingerichtet.');
                return json({ results: await database.restoreVideos(restoreIds(data.ids)) });
            }
            if (path === '/security/rate') {
                const buckets = await this.state.storage.get<RateBuckets>('rateBuckets') || {};
                const retryAfter = takeRateLimit(buckets, data.key, data.rule);
                await this.state.storage.put('rateBuckets', buckets);
                return json({ retryAfter });
            }
            if (path === '/quota/display') return json(await this.budget.displayCapacity(data.players, quality, data.participants));
            if (path === '/quota/capacity') return json(await this.budget.capacity(data.players, quality, data.participants));
            if (path === '/quota/token') return json({ token: await this.budget.tokenForJob(data.code, data.jobId!) });
            if (path === '/quota/reserve') await this.budget.reserve(data.code, data.rounds, data.players, quality, data.participants);
            else if (path === '/quota/extend') await this.budget.extend(data.code, data.players!, quality, data.participants);
            else if (path === '/quota/begin') await this.budget.begin(data.code, data.generations, data.jobId, data.playerId, data.ownRemaining, data.participant);
            else if (path === '/quota/consume') await this.budget.consume(data.code, data.jobId);
            else if (path === '/quota/release') await this.budget.release(data.code);
            else if (path === '/quota/drop') await this.budget.drop(data.code, data.generations, data.playerId);
            else if (path === '/quota/attempt') await this.budget.allowAttempt(data.code, data.seconds, data.jobId);
            else if (path === '/archive') {
                const database = getDatabase(this.env.DATABASE_URL);
                return json({ url: await archiveVideo(data.url, this.env, await database?.protectedVideoUrls() || [],
                    database ? urls => database.reconcileArchive(urls) : undefined, data.code) });
            }
            else if (path === '/archive/delete') await deleteArchivedVideo(data.url, this.env);
            else if (path === '/archive/status') return json(await archiveStatus(this.env, getDatabase(this.env.DATABASE_URL)));
            else if (path === '/profiles/create') return json({ profile: await this.profiles.create(data.name, data.passwordHash) || null });
            else if (path === '/profiles/password') return json({ profile: await this.profiles.setPassword(data.id, data.passwordHash!) || null });
            else if (path === '/profiles/find') return json({ profile: await this.profiles.find(data.name) || null });
            else if (path === '/profiles/list') return json({ profiles: await this.profiles.list() });
            else if (path === '/profiles/remove') return json({ profile: await this.profiles.remove(data.id) || null });
            return json({ ok: true });
        };
        // Mutations recheck capacity in their queue; HF I/O and quota views must not hold that queue.
        const independent = path.startsWith('/hf/') || ['/quota/display', '/quota/capacity', '/quota/token'].includes(path);
        const result = (independent ? Promise.resolve() : path.startsWith('/security/') ? this.securityOperations : path.startsWith('/quota/') ? this.quotaOperations : path.startsWith('/profiles/') ? this.profileOperations : this.archiveOperations).then(action).catch(error => {
            if (error instanceof HfOAuthError) console.info('[HF] OAuth callback failed', error.code);
            return json({ error: error instanceof Error ? error.message : 'Dienst nicht erreichbar.', ...(error instanceof HfRequiredError ? { code: 'hf_required' } : {}) }, { status: error instanceof HistoryError ? error.status : error instanceof HfRequiredError ? 403 : 503 });
        });
        if (independent) return result;
        if (path.startsWith('/security/')) this.securityOperations = result;
        else if (path.startsWith('/quota/')) this.quotaOperations = result;
        else if (path.startsWith('/profiles/')) this.profileOperations = result;
        else this.archiveOperations = result;
        return result;
    }

    private scheduleCleanup(time: number) {
        const result = this.alarmOperations.then(async () => {
            const alarm = await this.state.storage.getAlarm();
            if (alarm === null || alarm > time) await this.state.storage.setAlarm(time);
        });
        this.alarmOperations = result.catch(() => {});
        return result;
    }

    async alarm() {
        const result = this.archiveOperations.then(async () => {
            const database = getDatabase(this.env.DATABASE_URL);
            await purgeDeletedVideos(database, url => deleteArchivedVideo(url, this.env));
            const next = await database?.nextVideoDeletion();
            if (next !== undefined) await this.scheduleCleanup(Math.max(Date.now() + 100, next));
            const hfCleanup = await this.hf.cleanup();
            if (hfCleanup !== undefined) await this.scheduleCleanup(hfCleanup);
        }).catch(async () => { await this.scheduleCleanup(Date.now() + 30_000); });
        this.archiveOperations = result;
        await result;
    }
}
