import { DATABASE_SCHEMA } from './schema';
import { OVERVIEW_SQL, PLAYERS_SQL, VIDEOS_SQL, VIDEO_CREATORS_SQL, ROOMS_SQL } from './statistics';
import { COPY_VIDEO_HISTORY_SQL, VIDEO_PROJECTION } from './video-history';
import type { DatabaseDriver, SqlStatement, PersistPlayerInput, PersistRoundInput, FinalStandingInput, GameStats, StatsOverview, PlayerStats, VideoStats, RoomStats, VideoCreator, SavedVideo } from './types';

const scoresSql = `insert into players (room_code, socket_id, name, score, is_host, account_id)
    select $1, p.id, p.name, p.score, p.host, p.account
    from jsonb_to_recordset($2::jsonb) as p(id text, name text, score integer, host boolean, account text)
    on conflict (room_code, socket_id) do update set name = excluded.name, score = excluded.score,
        is_host = excluded.is_host, account_id = coalesce(players.account_id, excluded.account_id)`;
const finalSql = `update rooms set status = 'GAME_OVER', ended_at = coalesce(ended_at, now()),
    winner_socket_id = $2, winner_name = $3 where code = $1`;
const statement = (text: string, values?: unknown[]): SqlStatement => ({ text, values });

export class GameRepository {
    private schemaReady?: Promise<void>;
    constructor(private driver: DatabaseDriver) {}
    ensureSchema() {
        return this.schemaReady ??= this.driver.transaction(DATABASE_SCHEMA.map(text => statement(text)))
            .catch(error => { this.schemaReady = undefined; throw error; });
    }
    private async query<T>(text: string, values?: unknown[]) {
        await this.ensureSchema();
        return this.driver.query<T>(statement(text, values));
    }
    private async transaction(queries: SqlStatement[]) {
        await this.ensureSchema();
        await this.driver.transaction(queries);
    }
    async roomExists(code: string) {
        return (await this.query('select code from rooms where code = $1', [code])).length > 0;
    }
    async saveRoom(code: string, hostId: string, rounds: number) {
        await this.query(`insert into rooms (code, host_socket_id, max_rounds, status)
            values ($1, $2, $3, 'LOBBY') on conflict (code) do update set max_rounds = excluded.max_rounds
            where rooms.started_at is null`, [code, hostId, rounds]);
    }
    async savePlayer(player: PersistPlayerInput) {
        await this.query(scoresSql, [player.roomCode, JSON.stringify([{
            id: player.playerSocketId, account: player.accountId ?? null,
            name: player.name, score: player.score, host: player.isHost
        }])]);
    }
    async saveScores(code: string, players: NonNullable<PersistRoundInput['players']>, hostId: string) {
        await this.query(scoresSql, [code, JSON.stringify(players.map(player => ({
            id: player.id, account: player.accountId ?? null, name: player.name,
            score: player.score, host: player.id === hostId
        })))]);
    }
    async markRoomStarted(code: string) {
        await this.query(`update rooms set status = case when ended_at is null then 'PLAYING' else status end,
            started_at = coalesce(started_at, now()) where code = $1`, [code]);
    }
    async markRoomFinished(code: string, standings: FinalStandingInput[]) {
        const winner = standings[0];
        await this.transaction([
            statement(`update players set score = p.score, final_rank = p.rank
                from jsonb_to_recordset($2::jsonb) as p(id text, score integer, rank integer)
                where room_code = $1 and socket_id = p.id`, [code, JSON.stringify(standings.map(p => ({ id: p.playerSocketId, score: p.score, rank: p.finalRank })))]),
            statement(finalSql, [code, winner?.playerSocketId ?? null, winner?.name ?? null])
        ]);
    }
    async reopenRoom(code: string, rounds: number, hostId: string) {
        await this.transaction([
            statement(`update rooms set status = 'PLAYING', max_rounds = $2, host_socket_id = $3,
                ended_at = null, winner_socket_id = null, winner_name = null where code = $1`, [code, rounds, hostId]),
            statement('update players set final_rank = null, is_host = (socket_id = $2) where room_code = $1', [code, hostId])
        ]);
    }
    async saveRound(input: PersistRoundInput) {
        const ranks = new Map(input.standings?.map(p => [p.playerSocketId, p.finalRank]));
        const players = JSON.stringify((input.players || []).map(p => ({
            id: p.id, account: p.accountId ?? null, name: p.name, score: p.score,
            host: p.id === input.hostId, rank: ranks.get(p.id) ?? null
        })));
        // Batch each table without per-player/vote round trips, retaining one transaction.
        const queries = [
            statement(`insert into players (room_code, socket_id, name, score, is_host, final_rank, account_id)
                select $1, p.id, p.name, p.score, p.host, p.rank, p.account
                from jsonb_to_recordset($2::jsonb) as p(id text, account text, name text, score integer, host boolean, rank integer)
                on conflict (room_code, socket_id) do update set score = excluded.score,
                    is_host = excluded.is_host, final_rank = excluded.final_rank,
                    account_id = coalesce(players.account_id, excluded.account_id)`, [input.roomCode, players]),
            statement(`with saved_round as (
                insert into rounds (room_code, round_number, creator_socket_id, prompt, video_url, round_points)
                values ($1, $2, $3, $4, $5, $6) on conflict (room_code, round_number) do update set
                    creator_socket_id = excluded.creator_socket_id, prompt = excluded.prompt,
                    video_url = excluded.video_url, round_points = excluded.round_points returning id
            ) insert into votes (round_id, voter_socket_id, points)
            select r.id, v."voterSocketId", v.points from saved_round r,
                jsonb_to_recordset($7::jsonb) as v("voterSocketId" text, points integer)
            on conflict (round_id, voter_socket_id) do update set points = excluded.points`,
            [input.roomCode, input.roundNumber, input.creatorSocketId, input.prompt, input.videoUrl, input.roundPoints, JSON.stringify(input.votes)]),
            statement(`${COPY_VIDEO_HISTORY_SQL} and r.room_code = $1 and r.round_number = $2
                on conflict (id) do update set prompt = excluded.prompt, video_url = excluded.video_url,
                    round_points = excluded.round_points, creator_id = excluded.creator_id, creator_name = excluded.creator_name
                where video_history.delete_after is null`, [input.roomCode, input.roundNumber])
        ];
        if (input.standings) {
            const winner = input.standings[0];
            queries.push(statement(finalSql, [input.roomCode, winner?.playerSocketId ?? null, winner?.name ?? null]));
        }
        await this.transaction(queries);
    }
    async historyVideos(code: string, roundNumber?: number) {
        return this.query<SavedVideo>(`select ${VIDEO_PROJECTION}, h.delete_after::text as "deleteAfter"
            from video_history h join rounds r on r.id = h.id
            where r.room_code = $1 and ($2::int is null or r.round_number = $2) and h.video_url <> ''`, [code, roundNumber ?? null]);
    }
    async savedVideo(id: string) {
        return (await this.query<SavedVideo>(`select ${VIDEO_PROJECTION}, h.delete_after::text as "deleteAfter"
            from video_history h where h.id = $1::bigint and h.video_url <> ''`, [id]))[0];
    }
    async trashVideo(id: string, seconds: number) {
        const rows = await this.query<{ undoUntil: number }>(`with trashed as (
            update video_history set delete_after = coalesce(delete_after, clock_timestamp() + $2::int * interval '1 second')
            where id = $1::bigint and video_url <> '' and (delete_after is null or delete_after > clock_timestamp())
            returning id, delete_after
        ), cleared as (update rounds r set video_url = '' from trashed t where r.id = t.id)
        select (extract(epoch from delete_after) * 1000)::double precision as "undoUntil" from trashed`, [id, seconds]);
        return rows[0];
    }
    async restoreVideo(id: string) {
        const rows = await this.query<{ id: string }>(`with restored as (
            update video_history set delete_after = null
            where id = $1::bigint and video_url <> '' and (delete_after is null or delete_after > clock_timestamp())
            returning id, video_url
        ), relinked as (update rounds r set video_url = h.video_url from restored h where r.id = h.id)
        select id::text as id from restored`, [id]);
        return rows.length > 0;
    }
    async expiredVideos() {
        return this.query<{ id: string; videoUrl: string }>(`select id::text as id, video_url as "videoUrl"
            from video_history where video_url <> '' and delete_after <= clock_timestamp() order by delete_after limit 100`);
    }
    async protectedVideoUrls() {
        return (await this.query<{ url: string }>(`select video_url as url from video_history
            where video_url <> '' and delete_after > clock_timestamp()`)).map(row => row.url);
    }
    async finalizeVideoDeletion(id: string) {
        // Keep a small tombstone so migrations and delayed round writes cannot revive a deleted video.
        await this.query(`with purged as (update video_history set video_url = '', prompt = '', creator_name = '', creator_id = '', round_points = 0
            where id = $1::bigint and delete_after <= clock_timestamp() returning id)
            update rounds r set video_url = '' from purged p where r.id = p.id`, [id]);
    }
    async nextVideoDeletion() {
        const rows = await this.query<{ deadline: number | null }>(`select (extract(epoch from min(delete_after)) * 1000)::double precision as deadline from video_history where video_url <> '' and delete_after is not null`);
        return rows[0]?.deadline ? Number(rows[0].deadline) : undefined;
    }
    async deleteRoom(code: string) {
        await this.query('delete from rooms where code = $1', [code]);
    }
    async getStats(creatorId?: string): Promise<GameStats> {
        const overview = await this.query<StatsOverview>(OVERVIEW_SQL);
        const players = await this.query<PlayerStats>(PLAYERS_SQL);
        const recentVideos = await this.query<VideoStats>(VIDEOS_SQL, [creatorId || null]);
        const videoCreators = await this.query<VideoCreator>(VIDEO_CREATORS_SQL);
        const rooms = await this.query<RoomStats>(ROOMS_SQL);
        return { overview: overview[0], players, recentVideos, videoCreators, rooms };
    }
}
