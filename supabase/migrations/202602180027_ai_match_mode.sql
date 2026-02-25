begin;

alter table public.matches
  drop constraint if exists matches_type_check;

alter table public.matches
  add constraint matches_type_check check (type in ('friend', 'random', 'ai'));

create or replace function public.create_ai_match()
returns table (match_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match_id uuid;
begin
  if v_user is null then
    raise exception 'Unauthorized';
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
    attacker_slot,
    obstacles,
    obstacles_turn
  )
  values (
    'ai',
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
    1,
    '[]'::jsonb,
    null
  )
  returning id into v_match_id;

  insert into public.match_players (match_id, user_id, slot)
  values (v_match_id, v_user, 1);

  return query select v_match_id;
end;
$$;

create or replace function public.submit_bot_turn(p_match_id uuid, p_round integer, p_action jsonb)
returns public.turns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_turn public.turns%rowtype;
  v_round integer;
  v_max_steps integer;
  v_path jsonb;
  v_prev_row integer;
  v_prev_col integer;
  v_next_row integer;
  v_next_col integer;
  v_item jsonb;
  v_round_count integer;
  v_obstacles jsonb;
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
  if v_match.type <> 'ai' then
    raise exception 'Bot turn is only available in ai matches';
  end if;
  if v_match.status <> 'active' then
    raise exception 'Match is not active';
  end if;
  if v_match.phase <> 'planning' then
    raise exception 'Round is resolving';
  end if;
  if p_round <> v_match.current_turn then
    raise exception 'Stale round';
  end if;

  if v_match.planning_ends_at is not null and now() >= v_match.planning_ends_at then
    perform public.start_resolving_round(p_match_id);
    raise exception 'Planning window closed';
  end if;

  v_round := v_match.current_turn;
  v_max_steps := least(v_round + 4, 10);
  v_path := coalesce(p_action -> 'path', '[]'::jsonb);
  v_obstacles := coalesce(v_match.obstacles, '[]'::jsonb);

  if jsonb_typeof(v_path) <> 'array' then
    raise exception 'action.path must be an array';
  end if;
  if jsonb_array_length(v_path) > v_max_steps then
    raise exception 'Path length exceeds max steps';
  end if;

  v_prev_row := (v_match.board_state -> 'p2' ->> 0)::integer;
  v_prev_col := (v_match.board_state -> 'p2' ->> 1)::integer;

  for v_item in select * from jsonb_array_elements(v_path) loop
    if jsonb_typeof(v_item) <> 'array' or jsonb_array_length(v_item) <> 2 then
      raise exception 'Each path point must be [row, col]';
    end if;
    v_next_row := (v_item ->> 0)::integer;
    v_next_col := (v_item ->> 1)::integer;

    if v_next_row < 0 or v_next_row > 4 or v_next_col < 0 or v_next_col > 4 then
      raise exception 'Path point out of bounds';
    end if;
    if abs(v_next_row - v_prev_row) + abs(v_next_col - v_prev_col) <> 1 then
      raise exception 'Path must move one tile orthogonally';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_obstacles) as o
      where (o ->> 0)::integer = v_next_row
        and (o ->> 1)::integer = v_next_col
    ) then
      raise exception 'Path cannot pass through obstacles';
    end if;

    v_prev_row := v_next_row;
    v_prev_col := v_next_col;
  end loop;

  insert into public.turns (match_id, turn_number, player_slot, action_payload, created_by)
  values (
    p_match_id,
    v_round,
    2,
    jsonb_build_object('path', v_path),
    v_match.created_by
  )
  on conflict (match_id, turn_number, player_slot)
  do update set
    action_payload = excluded.action_payload,
    created_by = excluded.created_by,
    created_at = now()
  returning * into v_turn;

  select count(*)
    into v_round_count
  from public.turns t
  where t.match_id = p_match_id
    and t.turn_number = v_round;

  if v_round_count >= 2 then
    perform public.start_resolving_round(p_match_id);
  end if;

  return v_turn;
end;
$$;

revoke execute on function public.create_ai_match() from public;
grant execute on function public.create_ai_match() to authenticated;
revoke execute on function public.submit_bot_turn(uuid, integer, jsonb) from public;
grant execute on function public.submit_bot_turn(uuid, integer, jsonb) to authenticated;

commit;

