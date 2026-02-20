begin;

drop function if exists public.mark_player_connected(uuid);

create or replace function public.join_friend_match(p_room_code text)
returns table (match_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match_id uuid;
  v_current_count integer;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  select m.id
    into v_match_id
  from public.matches m
  where m.room_code = upper(trim(p_room_code))
    and m.type = 'friend'
    and m.status = 'waiting'
  for update;

  if v_match_id is null then
    raise exception 'Room not found or not joinable';
  end if;

  if exists (
    select 1 from public.match_players mp
    where mp.match_id = v_match_id and mp.user_id = v_user
  ) then
    return query select v_match_id;
    return;
  end if;

  select count(*) into v_current_count
  from public.match_players mp
  where mp.match_id = v_match_id;

  if v_current_count >= 2 then
    raise exception 'Room is full';
  end if;

  insert into public.match_players (match_id, user_id, slot)
  values (v_match_id, v_user, 2);

  update public.matches
  set status = 'active',
      started_at = now(),
      current_turn = 1,
      current_player_slot = 1,
      board_state = public.initial_board_state(),
      phase = 'planning',
      planning_ends_at = now() + interval '10 seconds',
      resolution_ends_at = null,
      resolved_paths = null,
      p1_hp = 3,
      p2_hp = 3,
      attacker_slot = 1
  where id = v_match_id;

  return query select v_match_id;
end;
$$;

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

  insert into public.matches (
    type,
    status,
    created_by,
    started_at,
    current_turn,
    current_player_slot,
    board_state,
    phase,
    planning_ends_at,
    resolution_ends_at,
    resolved_paths,
    p1_hp,
    p2_hp,
    attacker_slot
  )
  values (
    'random',
    'active',
    v_user,
    now(),
    1,
    1,
    public.initial_board_state(),
    'planning',
    now() + interval '10 seconds',
    null,
    null,
    3,
    3,
    1
  )
  returning id into v_match_id;

  insert into public.match_players (match_id, user_id, slot)
  values (v_match_id, v_user, v_my_slot),
         (v_match_id, v_opponent_user, v_other_slot);

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id, 'ticket_id', v_ticket_id);
end;
$$;

create or replace function public.request_rematch(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_slot smallint;
  v_match public.matches%rowtype;
  v_p1_user uuid;
  v_p2_user uuid;
  v_new_match_id uuid;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  select mp.slot
    into v_slot
  from public.match_players mp
  where mp.match_id = p_match_id
    and mp.user_id = v_user;

  if v_slot is null then
    raise exception 'You are not part of this match';
  end if;

  select *
    into v_match
  from public.matches m
  where m.id = p_match_id
  for update;

  if v_match.id is null then
    raise exception 'Match not found';
  end if;
  if v_match.status <> 'finished' then
    raise exception 'Rematch is available only after match finish';
  end if;

  if v_match.rematch_match_id is not null then
    return jsonb_build_object('status', 'started', 'match_id', v_match.rematch_match_id);
  end if;

  if v_slot = 1 then
    update public.matches
    set rematch_p1_requested = true
    where id = p_match_id
    returning * into v_match;
  else
    update public.matches
    set rematch_p2_requested = true
    where id = p_match_id
    returning * into v_match;
  end if;

  if not (v_match.rematch_p1_requested and v_match.rematch_p2_requested) then
    return jsonb_build_object('status', 'waiting');
  end if;

  select mp.user_id into v_p1_user
  from public.match_players mp
  where mp.match_id = p_match_id and mp.slot = 1
  limit 1;

  select mp.user_id into v_p2_user
  from public.match_players mp
  where mp.match_id = p_match_id and mp.slot = 2
  limit 1;

  if v_p1_user is null or v_p2_user is null then
    raise exception 'Cannot create rematch without two players';
  end if;

  insert into public.matches (
    type,
    status,
    created_by,
    started_at,
    current_turn,
    current_player_slot,
    board_state,
    phase,
    planning_ends_at,
    resolution_ends_at,
    resolved_paths,
    p1_hp,
    p2_hp,
    attacker_slot
  )
  values (
    v_match.type,
    'active',
    v_user,
    now(),
    1,
    1,
    public.initial_board_state(),
    'planning',
    now() + interval '10 seconds',
    null,
    null,
    3,
    3,
    1
  )
  returning id into v_new_match_id;

  insert into public.match_players (match_id, user_id, slot)
  values (v_new_match_id, v_p1_user, 1),
         (v_new_match_id, v_p2_user, 2);

  update public.matches
  set rematch_match_id = v_new_match_id
  where id = p_match_id;

  return jsonb_build_object('status', 'started', 'match_id', v_new_match_id);
end;
$$;

grant execute on function public.join_friend_match(text) to authenticated;
grant execute on function public.join_matchmaking_queue(uuid) to authenticated;
grant execute on function public.request_rematch(uuid) to authenticated;

commit;

