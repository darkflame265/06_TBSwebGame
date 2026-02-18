begin;

alter table public.matches
  add column if not exists phase text not null default 'planning' check (phase in ('planning', 'resolving')),
  add column if not exists resolution_ends_at timestamptz,
  add column if not exists resolved_paths jsonb;

update public.matches
set phase = 'planning'
where phase is null;

update public.matches
set planning_ends_at = now() + interval '10 seconds'
where status = 'active'
  and phase = 'planning'
  and planning_ends_at is null;

create or replace function public.start_resolving_round(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_round integer;
  v_path1 jsonb := '[]'::jsonb;
  v_path2 jsonb := '[]'::jsonb;
  v_p1_row integer;
  v_p1_col integer;
  v_p2_row integer;
  v_p2_col integer;
  v_steps integer;
  i integer;
begin
  select *
    into v_match
  from public.matches m
  where m.id = p_match_id
  for update;

  if v_match.id is null then
    raise exception 'Match not found';
  end if;
  if v_match.status <> 'active' then
    return v_match;
  end if;
  if v_match.phase <> 'planning' then
    return v_match;
  end if;

  if v_match.board_state is null then
    v_match.board_state := public.initial_board_state();
  end if;

  v_round := v_match.current_turn;

  select coalesce(t.action_payload -> 'path', '[]'::jsonb)
    into v_path1
  from public.turns t
  where t.match_id = p_match_id
    and t.turn_number = v_round
    and t.player_slot = 1
  limit 1;

  select coalesce(t.action_payload -> 'path', '[]'::jsonb)
    into v_path2
  from public.turns t
  where t.match_id = p_match_id
    and t.turn_number = v_round
    and t.player_slot = 2
  limit 1;

  v_p1_row := (v_match.board_state -> 'p1' ->> 0)::integer;
  v_p1_col := (v_match.board_state -> 'p1' ->> 1)::integer;
  v_p2_row := (v_match.board_state -> 'p2' ->> 0)::integer;
  v_p2_col := (v_match.board_state -> 'p2' ->> 1)::integer;

  v_steps := greatest(jsonb_array_length(v_path1), jsonb_array_length(v_path2));
  if v_steps > 0 then
    for i in 0..(v_steps - 1) loop
      if i < jsonb_array_length(v_path1) then
        v_p1_row := (v_path1 -> i ->> 0)::integer;
        v_p1_col := (v_path1 -> i ->> 1)::integer;
      end if;
      if i < jsonb_array_length(v_path2) then
        v_p2_row := (v_path2 -> i ->> 0)::integer;
        v_p2_col := (v_path2 -> i ->> 1)::integer;
      end if;
    end loop;
  end if;

  update public.matches
  set board_state = jsonb_build_object(
        'p1', jsonb_build_array(v_p1_row, v_p1_col),
        'p2', jsonb_build_array(v_p2_row, v_p2_col)
      ),
      phase = 'resolving',
      planning_ends_at = null,
      resolution_ends_at = now() + (greatest(v_steps, 1) * interval '350 milliseconds') + interval '150 milliseconds',
      resolved_paths = jsonb_build_object(
        'turn', v_round,
        'start', jsonb_build_object(
          'p1', v_match.board_state -> 'p1',
          'p2', v_match.board_state -> 'p2'
        ),
        'p1', v_path1,
        'p2', v_path2
      )
  where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;

create or replace function public.tick_match_round(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_round_count integer;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  if not exists (
    select 1
    from public.match_players mp
    where mp.match_id = p_match_id
      and mp.user_id = v_user
  ) then
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
  if v_match.status <> 'active' then
    return v_match;
  end if;

  if v_match.board_state is null then
    update public.matches
    set board_state = public.initial_board_state(),
        planning_ends_at = coalesce(planning_ends_at, now() + interval '10 seconds')
    where id = p_match_id
    returning * into v_match;
  end if;

  if v_match.phase = 'planning' then
    select count(*)
      into v_round_count
    from public.turns t
    where t.match_id = p_match_id
      and t.turn_number = v_match.current_turn;

    if v_round_count >= 2 or (v_match.planning_ends_at is not null and now() >= v_match.planning_ends_at) then
      return public.start_resolving_round(p_match_id);
    end if;
    return v_match;
  end if;

  if v_match.phase = 'resolving' then
    if v_match.resolution_ends_at is not null and now() >= v_match.resolution_ends_at then
      update public.matches
      set phase = 'planning',
          current_turn = current_turn + 1,
          planning_ends_at = now() + interval '10 seconds',
          resolution_ends_at = null,
          resolved_paths = null
      where id = p_match_id
      returning * into v_match;
    end if;
    return v_match;
  end if;

  return v_match;
end;
$$;

create or replace function public.submit_turn(p_match_id uuid, p_action jsonb)
returns public.turns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_slot smallint;
  v_match public.matches%rowtype;
  v_new_turn public.turns%rowtype;
  v_round integer;
  v_max_steps integer;
  v_path jsonb;
  v_prev_row integer;
  v_prev_col integer;
  v_next_row integer;
  v_next_col integer;
  v_item jsonb;
  v_round_count integer;
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
  if v_match.status <> 'active' then
    raise exception 'Match is not active';
  end if;
  if v_match.phase <> 'planning' then
    raise exception 'Round is resolving';
  end if;
  if v_match.planning_ends_at is not null and now() >= v_match.planning_ends_at then
    perform public.start_resolving_round(p_match_id);
    raise exception 'Planning window closed';
  end if;

  if v_match.board_state is null then
    v_match.board_state := public.initial_board_state();
    update public.matches
    set board_state = v_match.board_state,
        planning_ends_at = coalesce(planning_ends_at, now() + interval '10 seconds')
    where id = p_match_id
    returning * into v_match;
  end if;

  v_round := v_match.current_turn;
  v_max_steps := least(v_round, 10);
  v_path := coalesce(p_action -> 'path', '[]'::jsonb);

  if jsonb_typeof(v_path) <> 'array' then
    raise exception 'action.path must be an array';
  end if;
  if jsonb_array_length(v_path) > v_max_steps then
    raise exception 'Path length exceeds max steps';
  end if;

  if v_slot = 1 then
    v_prev_row := (v_match.board_state -> 'p1' ->> 0)::integer;
    v_prev_col := (v_match.board_state -> 'p1' ->> 1)::integer;
  else
    v_prev_row := (v_match.board_state -> 'p2' ->> 0)::integer;
    v_prev_col := (v_match.board_state -> 'p2' ->> 1)::integer;
  end if;

  for v_item in select * from jsonb_array_elements(v_path) loop
    if jsonb_typeof(v_item) <> 'array' or jsonb_array_length(v_item) <> 2 then
      raise exception 'Each path point must be [row, col]';
    end if;
    v_next_row := (v_item ->> 0)::integer;
    v_next_col := (v_item ->> 1)::integer;

    if v_next_row < 0 or v_next_row > 6 or v_next_col < 0 or v_next_col > 6 then
      raise exception 'Path point out of bounds';
    end if;
    if abs(v_next_row - v_prev_row) + abs(v_next_col - v_prev_col) <> 1 then
      raise exception 'Path must move one tile orthogonally';
    end if;

    v_prev_row := v_next_row;
    v_prev_col := v_next_col;
  end loop;

  insert into public.turns (match_id, turn_number, player_slot, action_payload, created_by)
  values (
    p_match_id,
    v_round,
    v_slot,
    jsonb_build_object('path', v_path),
    v_user
  )
  returning * into v_new_turn;

  select count(*)
    into v_round_count
  from public.turns t
  where t.match_id = p_match_id
    and t.turn_number = v_round;

  if v_round_count >= 2 then
    perform public.start_resolving_round(p_match_id);
  end if;

  return v_new_turn;
exception
  when unique_violation then
    raise exception 'You already submitted a path this round';
end;
$$;

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
      resolved_paths = null
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
    resolved_paths
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
    null
  )
  returning id into v_match_id;

  insert into public.match_players (match_id, user_id, slot)
  values (v_match_id, v_user, v_my_slot),
         (v_match_id, v_opponent_user, v_other_slot);

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id, 'ticket_id', v_ticket_id);
end;
$$;

revoke execute on function public.start_resolving_round(uuid) from public;
revoke execute on function public.tick_match_round(uuid) from public;
revoke execute on function public.submit_turn(uuid, jsonb) from public;

grant execute on function public.start_resolving_round(uuid) to authenticated;
grant execute on function public.tick_match_round(uuid) to authenticated;
grant execute on function public.submit_turn(uuid, jsonb) to authenticated;
grant execute on function public.join_friend_match(text) to authenticated;
grant execute on function public.join_matchmaking_queue(uuid) to authenticated;

commit;
