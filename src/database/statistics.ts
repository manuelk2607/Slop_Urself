export const OVERVIEW_SQL = `
        select
            count(*) filter (where started_at is not null)::int as "gamesPlayed",
            count(*) filter (where status = 'GAME_OVER')::int as "completedGames",
            (select count(*)::int from rounds) as "roundsPlayed",
            (select count(*)::int from votes) as "votesCast",
            (select count(*)::int from rounds where video_url <> '') as "videosArchived",
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
    `;
