begin;

alter table public.matchmaking_queue
  add column if not exists ticket_id uuid not null default gen_random_uuid(),
  add column if not exists expires_at timestamptz not null default (now() + interval '30 seconds');

create unique index if not exists uq_matchmaking_queue_ticket_id on public.matchmaking_queue(ticket_id);
create index if not exists idx_matchmaking_queue_expires_at on public.matchmaking_queue(expires_at);

create or replace function public.join_matchmaking_queue(p_ticket_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_opponent_user uuid;
  v_match_id uuid;
  v_my_slot smallint;
  v_other_slot smallint;
  v_existing_match uuid;
  v_ticket_id uuid := coalesce(p_ticket_id, gen_random_uuid());
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  delete from public.matchmaking_queue where expires_at <= now();

  select m.id
    into v_existing_match
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  where mp.user_id = v_user
    and m.type = 'random'
    and m.status = 'active'
  order by m.created_at desc
  limit 1;

  if v_existing_match is not null then
    delete from public.matchmaking_queue where user_id = v_user;
    return jsonb_build_object('status', 'matched', 'match_id', v_existing_match, 'ticket_id', v_ticket_id);
  end if;

  insert into public.matchmaking_queue (user_id, ticket_id, joined_at, expires_at)
  values (v_user, v_ticket_id, now(), now() + interval '30 seconds')
  on conflict (user_id) do update
  set ticket_id = excluded.ticket_id,
      joined_at = excluded.joined_at,
      expires_at = excluded.expires_at;

  select q.user_id
    into v_opponent_user
  from public.matchmaking_queue q
  where q.user_id <> v_user
    and q.expires_at > now()
  order by q.joined_at asc
  limit 1
  for update skip locked;

  if v_opponent_user is null then
    return jsonb_build_object('status', 'queued', 'ticket_id', v_ticket_id);
  end if;

  delete from public.matchmaking_queue
  where user_id in (v_user, v_opponent_user);

  if random() < 0.5 then
    v_my_slot := 1;
    v_other_slot := 2;
  else
    v_my_slot := 2;
    v_other_slot := 1;
  end if;

  insert into public.matches (type, status, created_by, started_at, current_turn, current_player_slot)
  values ('random', 'active', v_user, now(), 1, 1)
  returning id into v_match_id;

  insert into public.match_players (match_id, user_id, slot)
  values (v_match_id, v_user, v_my_slot),
         (v_match_id, v_opponent_user, v_other_slot);

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id, 'ticket_id', v_ticket_id);
end;
$$;

revoke execute on function public.join_matchmaking_queue(uuid) from public;
grant execute on function public.join_matchmaking_queue(uuid) to authenticated;

commit;
