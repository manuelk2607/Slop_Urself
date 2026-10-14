import { VIDEO_PROJECTION } from './video-history';

export const OVERVIEW_SQL = `
        select
            count(*) filter (where started_at is not null)::int as "gamesPlayed",
            count(*) filter (where status = 'GAME_OVER')::int as "completedGames",
            (select count(*)::int from rounds) as "roundsPlayed",
            (select count(*)::int from votes) as "votesCast",
            (select count(*)::int from video_history where video_url <> '' and delete_after is null and evicted_at is null) as "videosArchived",
            coalesce((select max(score)::int from players), 0) as "highestScore"
        from rooms
    `;

export const PLAYERS_SQL = `
        with player_totals as (
            select
                coalesce(account_id, 'legacy:' || lower(name)) as player_key,
                max(name) as name,
                count(distinct room_code) as "gamesPlayed",
                count(*) filter (where final_rank = 1)::int as wins,
                coalesce(sum(score), 0)::int as "totalScore",
                coalesce(avg(score), 0)::float as "averageScore"
            from players
            where room_code in (select code from rooms where started_at is not null)
            group by coalesce(account_id, 'legacy:' || lower(name))
        ),
        created_rounds as (
            select
                coalesce(p.account_id, 'legacy:' || lower(p.name)) as player_key,
                count(r.id)::int as "roundsCreated",
                coalesce(avg(r.round_points), 0)::float as "averageReceivedPoints"
            from rounds r
            join players p
              on p.room_code = r.room_code
             and p.socket_id = r.creator_socket_id
            group by coalesce(p.account_id, 'legacy:' || lower(p.name))
        ),
        given_votes as (
            select
                coalesce(p.account_id, 'legacy:' || lower(p.name)) as player_key,
                count(v.points)::int as "votesGiven",
                coalesce(avg(v.points), 0)::float as "averageVoteGiven"
            from votes v
            join rounds r on r.id = v.round_id
            join players p
              on p.room_code = r.room_code
             and p.socket_id = v.voter_socket_id
            group by coalesce(p.account_id, 'legacy:' || lower(p.name))
        )
        select
            pt.player_key as id,
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
    `;

export const VIDEOS_SQL = `
        select ${VIDEO_PROJECTION}
        from video_history h
        where h.video_url <> '' and h.delete_after is null
          and ($1::text is null or h.creator_id = $1)
          and ($2::timestamptz is null or (h.created_at, h.id) < ($2::timestamptz, $3::bigint))
        order by h.created_at desc, h.id desc
        limit 13
    `;

export const VIDEO_CREATORS_SQL = `select creator_id as id, max(creator_name) as name
    from video_history where video_url <> '' and delete_after is null
    group by creator_id order by lower(max(creator_name)), creator_id limit 200`;

export const ROOMS_SQL = `
        select r.code, r.status, r.winner_name as "winnerName",
            to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
            (select count(*)::int from players p where p.room_code = r.code) as "playerCount",
            (select count(*)::int from rounds v join video_history h on h.id = v.id
                where v.room_code = r.code and h.video_url <> '' and h.delete_after is null and h.evicted_at is null) as "videoCount",
            coalesce((select sum(p.score)::int from players p where p.room_code = r.code), 0) as "totalPoints"
        from rooms r
        where ($1::timestamptz is null or (r.created_at, r.code) < ($1::timestamptz, $2::text))
        order by r.created_at desc, r.code desc limit 51
    `;
