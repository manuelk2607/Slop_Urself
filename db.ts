import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool() {
    if (pool) return pool;

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return null;

    pool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
            ? false
            : { rejectUnauthorized: false }
    });

    return pool;
}

export interface PersistPlayerInput {
    roomCode: string;
    playerSocketId: string;
    name: string;
    score: number;
    isHost: boolean;
}

export interface FinalStandingInput {
    playerSocketId: string;
    name: string;
    score: number;
    finalRank: number;
}

export interface PersistRoundInput {
    roomCode: string;
    roundNumber: number;
    creatorSocketId: string;
    prompt: string;
    videoUrl: string;
    roundPoints: number;
    votes: { voterSocketId: string; points: number }[];
}

export interface PlayerStats {
    name: string;
    gamesPlayed: number;
    wins: number;
    roundsCreated: number;
    totalScore: number;
    averageScore: number;
    averageReceivedPoints: number;
    votesGiven: number;
    averageVoteGiven: number;
}

export interface StatsOverview {
    gamesPlayed: number;
    completedGames: number;
    roundsPlayed: number;
    votesCast: number;
    videosArchived: number;
    highestScore: number;
}

export interface VideoStats {
    roomCode: string;
    roundNumber: number;
    creatorName: string;
    prompt: string;
    videoUrl: string;
    roundPoints: number;
    createdAt: string;
}

export async function ensureDatabaseSchema() {
    const pool = getPool();
    if (!pool) return;

    await pool.query(`
        create table if not exists rooms (
            code text primary key,
            host_socket_id text not null,
            max_rounds integer not null,
            status text not null,
            winner_socket_id text,
            winner_name text,
            created_at timestamptz not null default now(),
            started_at timestamptz,
            ended_at timestamptz
        );

        create table if not exists players (
            room_code text not null references rooms(code) on delete cascade,
            socket_id text not null,
            name text not null,
            score integer not null default 0,
            final_rank integer,
            is_host boolean not null default false,
            joined_at timestamptz not null default now(),
            primary key (room_code, socket_id)
        );

        create table if not exists rounds (
            id bigserial primary key,
            room_code text not null references rooms(code) on delete cascade,
            round_number integer not null,
            creator_socket_id text not null,
            prompt text not null,
            video_url text not null,
            round_points integer not null,
            created_at timestamptz not null default now(),
            unique (room_code, round_number)
        );

        create table if not exists votes (
            round_id bigint not null references rounds(id) on delete cascade,
            voter_socket_id text not null,
            points integer not null,
            created_at timestamptz not null default now(),
            primary key (round_id, voter_socket_id)
        );

        create index if not exists players_name_idx on players(name);
        create index if not exists rounds_room_code_idx on rounds(room_code);
        create index if not exists votes_voter_socket_id_idx on votes(voter_socket_id);

        alter table rooms add column if not exists winner_socket_id text;
        alter table rooms add column if not exists winner_name text;
        alter table players add column if not exists final_rank integer;
    `);
}

export function isDatabaseEnabled() {
    return Boolean(getPool());
}

export async function saveRoom(code: string, hostSocketId: string, maxRounds: number) {
    const pool = getPool();
    if (!pool) return;

    await pool.query(
        `insert into rooms (code, host_socket_id, max_rounds, status)
         values ($1, $2, $3, 'LOBBY')
         on conflict (code) do update
         set host_socket_id = excluded.host_socket_id,
             max_rounds = excluded.max_rounds,
             status = excluded.status`,
        [code, hostSocketId, maxRounds]
    );
}

export async function savePlayer(player: PersistPlayerInput) {
    const pool = getPool();
    if (!pool) return;

    await pool.query(
        `insert into players (room_code, socket_id, name, score, is_host)
         values ($1, $2, $3, $4, $5)
         on conflict (room_code, socket_id) do update
         set name = excluded.name,
             score = excluded.score,
             is_host = excluded.is_host`,
        [player.roomCode, player.playerSocketId, player.name, player.score, player.isHost]
    );
}

export async function markRoomStarted(roomCode: string) {
    const pool = getPool();
    if (!pool) return;

    await pool.query(
        `update rooms
         set status = 'PLAYING',
             started_at = coalesce(started_at, now())
         where code = $1`,
        [roomCode]
    );
}

export async function markRoomFinished(roomCode: string, standings: FinalStandingInput[]) {
    const pool = getPool();
    if (!pool) return;

    const winner = standings[0];
    const client = await pool.connect();

    try {
        await client.query('begin');
        await client.query(
            `update rooms
             set status = 'GAME_OVER',
                 winner_socket_id = $2,
                 winner_name = $3,
                 ended_at = coalesce(ended_at, now())
             where code = $1`,
            [roomCode, winner?.playerSocketId ?? null, winner?.name ?? null]
        );

        for (const standing of standings) {
            await client.query(
                `update players
                 set score = $3,
                     final_rank = $4
                 where room_code = $1
                   and socket_id = $2`,
                [roomCode, standing.playerSocketId, standing.score, standing.finalRank]
            );
        }

        await client.query('commit');
    } catch (error) {
        await client.query('rollback');
        throw error;
    } finally {
        client.release();
    }
}

export async function saveRound(input: PersistRoundInput) {
    const pool = getPool();
    if (!pool) return;

    const client = await pool.connect();
    try {
        await client.query('begin');
        const roundResult = await client.query<{ id: string }>(
            `insert into rounds (room_code, round_number, creator_socket_id, prompt, video_url, round_points)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (room_code, round_number) do update
             set creator_socket_id = excluded.creator_socket_id,
                 prompt = excluded.prompt,
                 video_url = excluded.video_url,
                 round_points = excluded.round_points
             returning id`,
            [
                input.roomCode,
                input.roundNumber,
                input.creatorSocketId,
                input.prompt,
                input.videoUrl,
                input.roundPoints
            ]
        );

        const roundId = roundResult.rows[0].id;
        for (const vote of input.votes) {
            await client.query(
                `insert into votes (round_id, voter_socket_id, points)
                 values ($1, $2, $3)
                 on conflict (round_id, voter_socket_id) do update
                 set points = excluded.points`,
                [roundId, vote.voterSocketId, vote.points]
            );
        }

        await client.query('commit');
    } catch (error) {
        await client.query('rollback');
        throw error;
    } finally {
        client.release();
    }
}

export async function saveScores(roomCode: string, players: { id: string; name: string; score: number }[], hostId: string) {
    const pool = getPool();
    if (!pool) return;

    await Promise.all(players.map(player => savePlayer({
        roomCode,
        playerSocketId: player.id,
        name: player.name,
        score: player.score,
        isHost: player.id === hostId
    })));
}

export async function getStats(): Promise<{
    overview: StatsOverview;
    players: PlayerStats[];
    recentVideos: VideoStats[];
}> {
    const pool = getPool();
    if (!pool) {
        return {
            overview: {
                gamesPlayed: 0,
                completedGames: 0,
                roundsPlayed: 0,
                votesCast: 0,
                videosArchived: 0,
                highestScore: 0
            },
            players: [],
            recentVideos: []
        };
    }

    const overviewResult = await pool.query<StatsOverview>(`
        select
            count(*)::int as "gamesPlayed",
            count(*) filter (where status = 'GAME_OVER')::int as "completedGames",
            (select count(*)::int from rounds) as "roundsPlayed",
            (select count(*)::int from votes) as "votesCast",
            (select count(*)::int from rounds where video_url <> '') as "videosArchived",
            coalesce((select max(score)::int from players), 0) as "highestScore"
        from rooms
    `);

    const playersResult = await pool.query<PlayerStats>(`
        with player_totals as (
            select
                lower(name) as player_key,
                max(name) as name,
                count(distinct room_code) as "gamesPlayed",
                count(*) filter (where final_rank = 1)::int as wins,
                coalesce(sum(score), 0)::int as "totalScore",
                coalesce(avg(score), 0)::float as "averageScore"
            from players
            group by lower(name)
        ),
        created_rounds as (
            select
                lower(p.name) as player_key,
                count(r.id)::int as "roundsCreated",
                coalesce(avg(r.round_points), 0)::float as "averageReceivedPoints"
            from rounds r
            join players p
              on p.room_code = r.room_code
             and p.socket_id = r.creator_socket_id
            group by lower(p.name)
        ),
        given_votes as (
            select
                lower(p.name) as player_key,
                count(v.points)::int as "votesGiven",
                coalesce(avg(v.points), 0)::float as "averageVoteGiven"
            from votes v
            join rounds r on r.id = v.round_id
            join players p
              on p.room_code = r.room_code
             and p.socket_id = v.voter_socket_id
            group by lower(p.name)
        )
        select
            pt.name,
            pt."gamesPlayed"::int,
            coalesce(cr."roundsCreated", 0)::int as "roundsCreated",
            round(pt."averageScore"::numeric, 2)::float as "averageScore",
            round(coalesce(cr."averageReceivedPoints", 0)::numeric, 2)::float as "averageReceivedPoints",
            pt."totalScore"::int,
            pt.wins::int,
            coalesce(gv."votesGiven", 0)::int as "votesGiven",
            round(coalesce(gv."averageVoteGiven", 0)::numeric, 2)::float as "averageVoteGiven"
        from player_totals pt
        left join created_rounds cr on cr.player_key = pt.player_key
        left join given_votes gv on gv.player_key = pt.player_key
        order by pt."totalScore" desc, pt.name asc
        limit 50
    `);

    const videosResult = await pool.query<VideoStats>(`
        select
            r.room_code as "roomCode",
            r.round_number::int as "roundNumber",
            coalesce(p.name, 'Unbekannt') as "creatorName",
            r.prompt,
            r.video_url as "videoUrl",
            r.round_points::int as "roundPoints",
            r.created_at::text as "createdAt"
        from rounds r
        left join players p
          on p.room_code = r.room_code
         and p.socket_id = r.creator_socket_id
        where r.video_url <> ''
        order by r.created_at desc
        limit 12
    `);

    return {
        overview: overviewResult.rows[0],
        players: playersResult.rows,
        recentVideos: videosResult.rows
    };
}
