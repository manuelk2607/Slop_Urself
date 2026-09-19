"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDatabaseSchema = ensureDatabaseSchema;
exports.isDatabaseEnabled = isDatabaseEnabled;
exports.saveRoom = saveRoom;
exports.savePlayer = savePlayer;
exports.markRoomStarted = markRoomStarted;
exports.markRoomFinished = markRoomFinished;
exports.saveRound = saveRound;
exports.saveScores = saveScores;
exports.getStats = getStats;
const pg_1 = require("pg");
let pool = null;
function getPool() {
    if (pool)
        return pool;
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl)
        return null;
    pool = new pg_1.Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
            ? false
            : { rejectUnauthorized: false }
    });
    return pool;
}
function ensureDatabaseSchema() {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return;
        yield pool.query(`
        create table if not exists rooms (
            code text primary key,
            host_socket_id text not null,
            max_rounds integer not null,
            status text not null,
            created_at timestamptz not null default now(),
            started_at timestamptz,
            ended_at timestamptz
        );

        create table if not exists players (
            room_code text not null references rooms(code) on delete cascade,
            socket_id text not null,
            name text not null,
            score integer not null default 0,
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
    `);
    });
}
function isDatabaseEnabled() {
    return Boolean(getPool());
}
function saveRoom(code, hostSocketId, maxRounds) {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return;
        yield pool.query(`insert into rooms (code, host_socket_id, max_rounds, status)
         values ($1, $2, $3, 'LOBBY')
         on conflict (code) do update
         set host_socket_id = excluded.host_socket_id,
             max_rounds = excluded.max_rounds,
             status = excluded.status`, [code, hostSocketId, maxRounds]);
    });
}
function savePlayer(player) {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return;
        yield pool.query(`insert into players (room_code, socket_id, name, score, is_host)
         values ($1, $2, $3, $4, $5)
         on conflict (room_code, socket_id) do update
         set name = excluded.name,
             score = excluded.score,
             is_host = excluded.is_host`, [player.roomCode, player.playerSocketId, player.name, player.score, player.isHost]);
    });
}
function markRoomStarted(roomCode) {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return;
        yield pool.query(`update rooms
         set status = 'PLAYING',
             started_at = coalesce(started_at, now())
         where code = $1`, [roomCode]);
    });
}
function markRoomFinished(roomCode) {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return;
        yield pool.query(`update rooms
         set status = 'GAME_OVER',
             ended_at = coalesce(ended_at, now())
         where code = $1`, [roomCode]);
    });
}
function saveRound(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return;
        const client = yield pool.connect();
        try {
            yield client.query('begin');
            const roundResult = yield client.query(`insert into rounds (room_code, round_number, creator_socket_id, prompt, video_url, round_points)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (room_code, round_number) do update
             set creator_socket_id = excluded.creator_socket_id,
                 prompt = excluded.prompt,
                 video_url = excluded.video_url,
                 round_points = excluded.round_points
             returning id`, [
                input.roomCode,
                input.roundNumber,
                input.creatorSocketId,
                input.prompt,
                input.videoUrl,
                input.roundPoints
            ]);
            const roundId = roundResult.rows[0].id;
            for (const vote of input.votes) {
                yield client.query(`insert into votes (round_id, voter_socket_id, points)
                 values ($1, $2, $3)
                 on conflict (round_id, voter_socket_id) do update
                 set points = excluded.points`, [roundId, vote.voterSocketId, vote.points]);
            }
            yield client.query('commit');
        }
        catch (error) {
            yield client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function saveScores(roomCode, players, hostId) {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return;
        yield Promise.all(players.map(player => savePlayer({
            roomCode,
            playerSocketId: player.id,
            name: player.name,
            score: player.score,
            isHost: player.id === hostId
        })));
    });
}
function getStats() {
    return __awaiter(this, void 0, void 0, function* () {
        const pool = getPool();
        if (!pool)
            return [];
        const result = yield pool.query(`
        with player_totals as (
            select
                lower(name) as player_key,
                max(name) as name,
                count(distinct room_code) as "gamesPlayed",
                coalesce(sum(score), 0)::int as "totalScore"
            from players
            group by lower(name)
        ),
        created_rounds as (
            select
                lower(p.name) as player_key,
                count(r.id)::int as "roundsCreated"
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
            pt."totalScore"::int,
            coalesce(gv."votesGiven", 0)::int as "votesGiven",
            round(coalesce(gv."averageVoteGiven", 0)::numeric, 2)::float as "averageVoteGiven"
        from player_totals pt
        left join created_rounds cr on cr.player_key = pt.player_key
        left join given_votes gv on gv.player_key = pt.player_key
        order by pt."totalScore" desc, pt.name asc
        limit 50
    `);
        return result.rows;
    });
}
