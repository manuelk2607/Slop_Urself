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
