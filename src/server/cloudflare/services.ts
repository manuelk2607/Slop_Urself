import { sqlProfiles, storedProfiles, type Profile, type ManagedProfileStore } from '../../auth/profiles';
import { getSql, getDatabase } from '../../database/neon';
import { purgeDeletedVideos, deleteStoredHistory, HistoryError, type HistoryDeletion } from '../statistics';
import { PlayerQuotaBudget, type BudgetPlayer } from '../../ai/player-quota';
import { HfConnections, HfOAuthError, HfRequiredError, requirePlayerHf } from '../../auth/huggingface';
import { profileAuthConfig, type Account } from '../../auth/session';
import { generationQuality } from '../../ai/providers';
import { archiveVideo, deleteArchivedVideo, listArchive, archiveLimit, archiveEnabled, MAX_VIDEO_BYTES, type ArchiveArtifact } from '../../storage/archive';
import { ArchiveStatusCache } from '../archive';
import { takeRateLimit, type RateBuckets, type RateRule } from '../../security/rate-limit';
import { json } from './runtime';
import type { DurableObjectState, Env } from './types';
import { restoreIds } from '../../shared/history';
import { ModerationError, blockedGenerationCapacity, generationSafetyReady } from '../../security/moderation';
import { ContentReports, type ReportReason } from '../../security/reports';
import { ArchiveReservations } from '../../storage/reservations';
import { verifyHfRoster } from '../../auth/hf-roster';
import { StoredModerationJournal } from '../../security/moderation-journal';
import { ProducerClaims, verifyProducerPermit } from '../../security/producer-claims';
import { validationConfig, validationScope, validationMember, parseValidationCampaign, ValidationLedger, type ValidationAdmission } from '../../security/live-validation';
import { boundedJson } from '../body';
import { approvedProvider, verifyPinnedProvider } from '../../ai/provider-trust';
import { probePersonalProxy, personalProxyFailure } from '../../ai/personal-proxy';

export class ServiceDurableObject {
    private quotaOperations: Promise<unknown> = Promise.resolve();
    private archiveOperations: Promise<unknown> = Promise.resolve();
    private profileOperations: Promise<unknown> = Promise.resolve();
    private securityOperations: Promise<unknown> = Promise.resolve();
    private alarmOperations: Promise<unknown> = Promise.resolve();
    private profiles: ManagedProfileStore;
    private budget: PlayerQuotaBudget;
    private hf: HfConnections;
    private reports: ContentReports;
    private archiveReservations: ArchiveReservations;
    private archiveInventory: ArchiveStatusCache;
    private moderationJournal: StoredModerationJournal;
    private producerClaims: ProducerClaims;
    constructor(private state: DurableObjectState, private env: Env) {
        this.profiles = env.DATABASE_URL ? sqlProfiles(async (sql, values) => await getSql(env.DATABASE_URL)!.query(sql, values) as Profile[]) : storedProfiles(state.storage);
        this.hf = new HfConnections(state.storage, profileAuthConfig(env, this.profiles));
        this.reports = new ContentReports(state.storage);
        this.archiveReservations = new ArchiveReservations(state.storage);
        this.archiveInventory = new ArchiveStatusCache(env);
        this.moderationJournal = new StoredModerationJournal(state.storage);
        this.producerClaims = new ProducerClaims(state.storage, env.WAN_PRODUCER_SECRET);
        this.budget = new PlayerQuotaBudget(state.storage, env, this.hf);
    }
    async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        const action = async () => {
            const data = await request.json() as { code: string; rounds: number; players?: number; quality?: unknown; generations: number; seconds: number; jobId?: string; url: string; name: string; id: string; key: string; rule: RateRule; time: number; command: HistoryDeletion;
                participants?: BudgetPlayer[]; participant?: BudgetPlayer; playerId?: string; ownRemaining?: number; permit?: string; admission?: Omit<ValidationAdmission, 'claimed'>;
                account: Account; accountId: string; connection?: string; state?: string; nonce?: string; origin: string; passwordHash?: string; ids?: unknown; reason: ReportReason; cost?: number; artifact?: ArchiveArtifact; urls: string[] };
            if (path === '/security/validation/identity') {
                let phase = 'scope';
                try {
                    const scope = validationScope(validationConfig(this.env, data.code || ''));
                    if (!scope) throw new Error('validation_scope_unavailable');
                    phase = 'membership'; const member = validationMember(scope, data.accountId);
                    phase = 'credential'; const credential = await this.hf.credential(data.connection, data.accountId);
                    phase = 'ownership'; if (credential.subject !== member.subject) throw new HfRequiredError();
                    phase = 'producer'; return json(await probePersonalProxy(credential.token));
                } catch (error) {
                    const kind = error instanceof TypeError ? 'TypeError' : error instanceof HfRequiredError ? 'HfRequiredError' : 'Error';
                    return json({ probeFailed: true, phase, errorKind: kind, code: personalProxyFailure(error), gpuCalls: 0, billingVerified: false });
                }
            }
            const quality = generationQuality(data.quality);
            const config = validationConfig(this.env, data.code || ''), scope = validationScope(config);
            const campaign = parseValidationCampaign(this.env.LIVE_VALIDATION_CAMPAIGN);
            const ledger = campaign && new ValidationLedger(this.state.storage, campaign);
            const budget = scope ? new PlayerQuotaBudget(this.state.storage, config, this.hf, (player, subject) => {
                if (validationMember(scope, player.accountId).subject !== subject) throw new HfRequiredError();
            }) : this.budget;
            const blocked = blockedGenerationCapacity(config, data.players || 1);
            if (path === '/security/producer/claim') {
                if (ledger) await ledger.claim(await verifyProducerPermit(data.permit, this.env.WAN_PRODUCER_SECRET));
                else { generationSafetyReady(this.env); await this.producerClaims.claim(data.permit); }
                return json({ claimed: true });
            }
            if (path === '/security/validation/context') {
                if (!scope || !ledger || !data.jobId) throw new Error('Keine aktive begrenzte Prüfung.');
                return json({ accountId: (await ledger.context(data.jobId)).accountId });
            }
            if (path === '/security/validation/ready') {
                if (!scope || data.participants?.length !== 2 || new Set(data.participants.map(p => p.accountId)).size !== 2) throw new Error('Keine vollständige Prüfrunde.');
                generationSafetyReady(config);
                if (!archiveEnabled(config)) throw new Error('Prüfarchiv nicht eingerichtet.');
                const archiveBytes = (await listArchive(config)).reduce((sum, object) => sum + object.size, 0);
                if (archiveBytes + await this.archiveReservations.pendingBytes() + 2 * MAX_VIDEO_BYTES > archiveLimit(config)) throw new Error('Für die zwei Prüfvideos fehlt freier Archivplatz; vorhandene Videos werden nicht gelöscht.');
                const host = 'https://manuel2607-slopurself-wan22-validated.hf.space';
                await verifyPinnedProvider(approvedProvider(config), host, async url => {
                    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
                    if (!r.ok) { await r.body?.cancel(); throw new Error('Producer noch nicht bereit.'); }
                    return boundedJson(r, 512 * 1024);
                });
                const health = new URL(scope.campaign.moderatorUrl); health.pathname = '/health';
                const response = await fetch(health, { redirect: 'manual', headers: { authorization: `Bearer ${config.MODERATION_SECRET}`, 'x-live-validation': scope.campaign.id }, signal: AbortSignal.timeout(10_000) });
                if (!response.ok) { await response.body?.cancel(); throw new Error('Prüfgateway nicht bereit.'); }
                const readiness = await boundedJson(response, 8192) as Record<string, unknown>;
                if (readiness.scopedReady !== true || readiness.validationScope !== scope.campaign.id || readiness.modelVersion !== config.MODERATION_MODEL_VERSION
                    || readiness.qualifiedForGeneralUse !== false) throw new Error('Prüfgateway nicht bestätigt.');
                for (const player of data.participants) {
                    const member = validationMember(scope, player.accountId), credential = await this.hf.credential(player.hfConnectionId, player.accountId);
                    if (credential.subject !== member.subject) throw new HfRequiredError();
                    const identity = await probePersonalProxy(credential.token);
                    if (identity.personalIdentityVerified !== true || identity.proxySubjectMatches !== true) throw new Error('Persönliche ZeroGPU-Zuordnung nicht bestätigt.');
                }
                return json({ ready: true, gpuCalls: 0 });
            }
            if (path === '/security/validation/admit') {
                if (!scope || !ledger || !data.admission || !data.participant || data.participant.accountId !== data.admission.accountId) throw new Error('Kein persönlicher Prüfauftrag.');
                const credential = await this.hf.credential(data.participant.hfConnectionId, data.participant.accountId);
                if (credential.subject !== data.admission.subject) throw new HfRequiredError();
                await ledger.admit(data.admission); return json({ ok: true });
            }
            if (scope && ['/quota/reserve', '/quota/extend'].includes(path) && (path.endsWith('extend') || data.rounds !== 1 || data.players !== 2
                || data.participants?.length !== 2 || new Set(data.participants.map(p => p.accountId)).size !== 2)) throw new Error('Nur eine vollständige Zwei-Spieler-Prüfrunde ist freigegeben.');
            if (scope && path === '/quota/begin' && (await ledger!.context(data.jobId!)).accountId !== data.participant?.accountId) throw new Error('Prüfauftrag ohne passende persönliche Zulassung.');
            if (scope && path === '/quota/attempt' && data.seconds !== 120) throw new Error('Nicht genehmigtes GPU-Budget.');
            if (blocked && ['/quota/display', '/quota/capacity'].includes(path)) return json(blocked);
            if (blocked && ['/quota/reserve', '/quota/extend', '/quota/begin', '/quota/attempt'].includes(path)) generationSafetyReady(config);
            if (path === '/security/content/blocked') return json({ blocked: await this.reports.blocked(data.url) });
            if (path === '/security/content/allowed') return json({ allowedUrls: await this.reports.allowed(data.urls) });
            if (path === '/security/content/list') return json({ reports: await this.reports.list() });
            if (path === '/security/content/report') { await this.reports.report(data.url, data.accountId, data.reason); return json({ ok: true }); }
            if (path === '/security/content/block') { await this.reports.block(data.url, data.accountId); return json({ ok: true }); }
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
            if (path === '/hf/roster') { await verifyHfRoster(this.env, data.participants || [], this.hf); return json({ ok: true }); }
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
                const retryAfter = takeRateLimit(buckets, data.key, data.rule, Date.now(), data.cost);
                await this.state.storage.put('rateBuckets', buckets);
                return json({ retryAfter });
            }
            if (path === '/quota/display') { const capacity = await budget.displayCapacity(data.players, quality, data.participants); return json(scope ? { ...capacity, aiRoundLimit: Math.min(1, capacity.aiRoundLimit) } : capacity); }
            if (path === '/quota/capacity') { const capacity = await budget.capacity(data.players, quality, data.participants); return json(scope ? { ...capacity, aiRoundLimit: Math.min(1, capacity.aiRoundLimit) } : capacity); }
            if (path === '/quota/token') return json({ token: await budget.tokenForJob(data.code, data.jobId!) });
            if (path === '/quota/reserve') await budget.reserve(data.code, data.rounds, data.players, quality, data.participants);
            else if (path === '/quota/extend') await budget.extend(data.code, data.players!, quality, data.participants);
            else if (path === '/quota/begin') await budget.begin(data.code, data.generations, data.jobId, data.playerId, data.ownRemaining, data.participant);
            else if (path === '/quota/consume') await budget.consume(data.code, data.jobId);
            else if (path === '/quota/release') await budget.release(data.code);
            else if (path === '/quota/drop') await budget.drop(data.code, data.generations, data.playerId);
            else if (path === '/quota/attempt') await budget.allowAttempt(data.code, data.seconds, data.jobId);
            else if (path === '/archive') {
                let archiveConfig = config;
                if (scope) {
                    if (!data.artifact || !ledger) throw new Error('Archivierung ohne Prüfauftrag.');
                    const admission = await ledger.context(data.artifact.generationId), source = new URL(data.url);
                    if (!admission.claimed || source.origin !== 'https://manuel2607-slopurself-wan22-validated.hf.space'
                        || !source.pathname.endsWith(`/private-videos/${admission.jobId}.mp4`)) throw new Error('Unbekannte Prüfausgabe.');
                    archiveConfig = validationConfig(this.env, data.code, { id: admission.jobId, accountId: admission.accountId });
                }
                const database = getDatabase(this.env.DATABASE_URL);
                await this.scheduleCleanup(Date.now() + 360_000);
                this.archiveInventory.invalidate();
                const url = await archiveVideo(data.url, { ...archiveConfig, moderationJournal: this.moderationJournal }, [...await database?.protectedVideoUrls() || [], ...await this.archiveReservations.activeUrls()],
                    database && !scope ? urls => database.reconcileArchive(urls) : undefined, data.code, data.artifact, await this.archiveReservations.pendingBytes(data.artifact?.generationId));
                if (url.startsWith('/api/videos/') && data.code) await this.archiveReservations.protect(data.code, url);
                return json({ url });
            }
            else if (path === '/archive/preflight') {
                if (this.env.AI_PROVIDER !== 'mock') await this.archiveReservations.reserve(data.jobId!, data.code, config, await getDatabase(this.env.DATABASE_URL)?.protectedVideoUrls() || []);
            }
            else if (path === '/archive/release') await this.archiveReservations.release(data.jobId!);
            else if (path === '/archive/protect') await this.archiveReservations.protect(data.code, data.url);
            else if (path === '/archive/delete') { this.archiveInventory.invalidate(); await deleteArchivedVideo(data.url, this.env); }
            else if (path === '/archive/status') return json(await this.archiveInventory.read(getDatabase(this.env.DATABASE_URL)));
            else if (path === '/profiles/create') return json({ profile: await this.profiles.create(data.name, data.passwordHash) || null });
            else if (path === '/profiles/password') return json({ profile: await this.profiles.setPassword(data.id, data.passwordHash!) || null });
            else if (path === '/profiles/find') return json({ profile: await this.profiles.find(data.name) || null });
            else if (path === '/profiles/list') return json({ profiles: await this.profiles.list() });
            else if (path === '/profiles/remove') return json({ profile: await this.profiles.remove(data.id) || null });
            return json({ ok: true });
        };
        // Mutations recheck capacity in their queue; HF I/O and quota views must not hold that queue.
        const independent = path.startsWith('/hf/') || ['/quota/display', '/quota/capacity', '/quota/token', '/security/validation/ready', '/security/validation/identity'].includes(path);
        const result = (independent ? Promise.resolve() : path.startsWith('/security/') ? this.securityOperations : path.startsWith('/quota/') ? this.quotaOperations : path.startsWith('/profiles/') ? this.profileOperations : this.archiveOperations).then(action).catch(error => {
            if (error instanceof HfOAuthError) console.info('[HF] OAuth callback failed', error.code);
            return json({ error: error instanceof Error ? error.message : 'Dienst nicht erreichbar.', ...(error instanceof HfRequiredError ? { code: 'hf_required' } : error instanceof ModerationError || error instanceof HfOAuthError ? { code: error.code } : {}) }, { status: error instanceof HistoryError ? error.status : error instanceof HfRequiredError ? 403 : 503 });
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
            await this.moderationJournal.cleanup();
            await purgeDeletedVideos(database, url => { this.archiveInventory.invalidate(); return deleteArchivedVideo(url, this.env); });
            const next = await database?.nextVideoDeletion();
            if (next !== undefined) await this.scheduleCleanup(Math.max(Date.now() + 100, next));
            const hfCleanup = await this.hf.cleanup();
            if (hfCleanup !== undefined) await this.scheduleCleanup(hfCleanup);
        }).catch(async () => { await this.scheduleCleanup(Date.now() + 30_000); });
        this.archiveOperations = result;
        await result;
    }
}
