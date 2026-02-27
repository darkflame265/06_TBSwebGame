begin;

create or replace function public.ensure_planning_obstacles(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_p1_row integer;
  v_p1_col integer;
  v_p2_row integer;
  v_p2_col integer;
  v_chaser_row integer;
  v_chaser_col integer;
  v_runner_row integer;
  v_runner_col integer;
  v_seed bigint;
  v_a bigint := 1103515245;
  v_c bigint := 12345;
  v_m bigint := 2147483648;
  v_r float8;
  v_pick_row integer;
  v_pick_col integer;
  v_candidates jsonb := '[]'::jsonb;
  v_idx integer;
  v_obstacle_count integer := 0;
  v_obstacles jsonb := '[]'::jsonb;
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

  if v_match.status <> 'active'
     or v_match.phase <> 'planning'
     or v_match.board_state is null
     or v_match.obstacles_turn is not distinct from v_match.current_turn then
    return v_match;
  end if;

  v_p1_row := (v_match.board_state -> 'p1' ->> 0)::integer;
  v_p1_col := (v_match.board_state -> 'p1' ->> 1)::integer;
  v_p2_row := (v_match.board_state -> 'p2' ->> 0)::integer;
  v_p2_col := (v_match.board_state -> 'p2' ->> 1)::integer;

  if v_match.attacker_slot = 1 then
    v_chaser_row := v_p1_row;
    v_chaser_col := v_p1_col;
    v_runner_row := v_p2_row;
    v_runner_col := v_p2_col;
  else
    v_chaser_row := v_p2_row;
    v_chaser_col := v_p2_col;
    v_runner_row := v_p1_row;
    v_runner_col := v_p1_col;
  end if;

  -- Avoid bigint overflow on abs(INT64_MIN).
  v_seed := hashtextextended(
    p_match_id::text || ':' || v_match.current_turn::text,
    0
  ) & 2147483647::bigint;

  for v_pick_row in 0..4 loop
    for v_pick_col in 0..4 loop
      if not (
        (v_pick_row = v_chaser_row and v_pick_col = v_chaser_col) or
        (v_pick_row = v_runner_row and v_pick_col = v_runner_col)
      ) then
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_array(v_pick_row, v_pick_col));
      end if;
    end loop;
  end loop;

  while jsonb_array_length(v_candidates) > 0 and v_obstacle_count < 3 loop
    v_seed := (v_a * v_seed + v_c) % v_m;
    v_r := (v_seed::float8 / v_m::float8);
    v_idx := floor(v_r * jsonb_array_length(v_candidates))::integer;
    if v_idx < 0 then v_idx := 0; end if;
    if v_idx >= jsonb_array_length(v_candidates) then
      v_idx := jsonb_array_length(v_candidates) - 1;
    end if;

    v_obstacles := v_obstacles || jsonb_build_array(v_candidates -> v_idx);
    v_candidates :=
      coalesce((
        select jsonb_agg(elem)
        from (
          select elem, ord
          from jsonb_array_elements(v_candidates) with ordinality as t(elem, ord)
          where ord <> v_idx + 1
        ) q
      ), '[]'::jsonb);
    v_obstacle_count := v_obstacle_count + 1;
  end loop;

  update public.matches
  set obstacles = v_obstacles,
      obstacles_turn = v_match.current_turn
  where id = p_match_id
    and current_turn = v_match.current_turn
    and phase = 'planning'
  returning * into v_match;

  return v_match;
end;
$$;

create or replace function public.get_match_live_snapshot(
  p_match_id uuid,
  p_turn_scope text default 'current'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_turns jsonb := '[]'::jsonb;
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
  where m.id = p_match_id;

  if v_match.id is null then
    raise exception 'Match not found';
  end if;

  v_match := public.ensure_planning_obstacles(p_match_id);

  if p_turn_scope = 'current' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'turn_number', t.turn_number,
          'player_slot', t.player_slot,
          'action_payload', t.action_payload,
          'created_by', t.created_by,
          'created_at', t.created_at
        )
        order by t.turn_number asc, t.player_slot asc
      ),
      '[]'::jsonb
    )
    into v_turns
    from public.turns t
    where t.match_id = p_match_id
      and t.turn_number = v_match.current_turn;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'turn_number', t.turn_number,
          'player_slot', t.player_slot,
          'action_payload', t.action_payload,
          'created_by', t.created_by,
          'created_at', t.created_at
        )
        order by t.turn_number asc, t.player_slot asc
      ),
      '[]'::jsonb
    )
    into v_turns
    from public.turns t
    where t.match_id = p_match_id;
  end if;

  return to_jsonb(v_match) || jsonb_build_object('turns', v_turns);
end;
$$;

create or replace function public.ack_resolve_and_prepare(
  p_match_id uuid,
  p_turn integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
begin
  v_match := public.ack_resolve(p_match_id, p_turn);
  v_match := public.tick_match_round(p_match_id);
  v_match := public.ensure_planning_obstacles(p_match_id);
  return public.get_match_live_snapshot(p_match_id, 'current');
end;
$$;

create or replace function public.submit_turn_and_get_ai_context(
  p_match_id uuid,
  p_round integer,
  p_action jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turn public.turns%rowtype;
  v_match public.matches%rowtype;
  v_bot_submitted boolean := false;
begin
  v_turn := public.submit_turn(p_match_id, p_round, p_action);

  select *
    into v_match
  from public.matches m
  where m.id = p_match_id;

  if v_match.id is null then
    raise exception 'Match not found';
  end if;

  if v_match.type = 'ai'
     and v_match.status = 'active'
     and v_match.phase = 'planning'
     and v_match.current_turn = p_round then
    select exists (
      select 1
      from public.turns t
      where t.match_id = p_match_id
        and t.turn_number = v_match.current_turn
        and t.player_slot = 2
    ) into v_bot_submitted;
  end if;

  return jsonb_build_object(
    'submitted_turn', to_jsonb(v_turn),
    'ai_context', case
      when v_match.type = 'ai'
       and v_match.status = 'active'
       and v_match.phase = 'planning'
       and v_match.current_turn = p_round
      then jsonb_build_object(
        'current_turn', v_match.current_turn,
        'attacker_slot', v_match.attacker_slot,
        'board_state', v_match.board_state,
        'obstacles', coalesce(v_match.obstacles, '[]'::jsonb),
        'bot_submitted', v_bot_submitted
      )
      else null
    end
  );
end;
$$;

revoke execute on function public.ensure_planning_obstacles(uuid) from public;
grant execute on function public.ensure_planning_obstacles(uuid) to authenticated;

revoke execute on function public.get_match_live_snapshot(uuid, text) from public;
grant execute on function public.get_match_live_snapshot(uuid, text) to authenticated;

revoke execute on function public.ack_resolve_and_prepare(uuid, integer) from public;
grant execute on function public.ack_resolve_and_prepare(uuid, integer) to authenticated;

revoke execute on function public.submit_turn_and_get_ai_context(uuid, integer, jsonb) from public;
grant execute on function public.submit_turn_and_get_ai_context(uuid, integer, jsonb) to authenticated;

commit;
