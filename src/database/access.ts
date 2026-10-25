// Read-only CTEs restrict all statistics tables to shared games. Original tables
// are schema-qualified so CTE shadowing cannot recursively widen the scope.
export function scopeHistoryQuery(text: string, values: unknown[] = [], viewerId?: string) {
    if (!viewerId) return { text, values };
    const actor = `$${values.length + 1}::text`;
    const ctes = `rooms as (select r.* from public.rooms r where exists
        (select 1 from public.players access_player where access_player.room_code = r.code and access_player.account_id = ${actor})),
        players as (select p.* from public.players p join rooms scope_room on scope_room.code = p.room_code),
        rounds as (select r.* from public.rounds r join rooms scope_room on scope_room.code = r.room_code),
        votes as (select v.* from public.votes v join rounds scope_round on scope_round.id = v.round_id),
        video_history as (select h.* from public.video_history h where h.creator_id = ${actor}
            or exists (select 1 from rooms scope_room where scope_room.code = h.room_code))`;
    const existingWith = /^\s*with\s+/i.test(text);
    return { text: `with ${ctes}${existingWith ? ', ' + text.replace(/^\s*with\s+/i, '') : ' ' + text}`, values: [...values, viewerId] };
}
