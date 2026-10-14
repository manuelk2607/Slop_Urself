// Video metadata deliberately has no foreign key to rooms, rounds or profiles.
export const VIDEO_HISTORY_SCHEMA = `create table if not exists video_history (
    id bigint primary key,
    room_code text not null,
    round_number integer not null,
    creator_id text not null,
    creator_name text not null,
    prompt text not null,
    video_url text not null,
    round_points integer not null,
    created_at timestamptz not null,
    delete_after timestamptz
)`;

export const COPY_VIDEO_HISTORY_SQL = `insert into video_history
    (id, room_code, round_number, creator_id, creator_name, prompt, video_url, round_points, created_at)
    select r.id, r.room_code, r.round_number,
        coalesce(p.account_id, 'legacy:' || lower(p.name), 'unknown:' || r.creator_socket_id),
        coalesce(p.name, 'Unbekannt'), r.prompt, r.video_url, r.round_points, r.created_at
    from rounds r left join players p on p.room_code = r.room_code and p.socket_id = r.creator_socket_id
    where r.video_url <> ''`;

export const VIDEO_PROJECTION = `h.id::text as id, h.room_code as "roomCode", h.round_number as "roundNumber",
    h.creator_id as "creatorId", h.creator_name as "creatorName", h.prompt,
    h.video_url as "videoUrl", h.round_points as "roundPoints", h.created_at::text as "createdAt",
    not exists (select 1 from rounds r where r.id = h.id) as "roomDeleted"`;
