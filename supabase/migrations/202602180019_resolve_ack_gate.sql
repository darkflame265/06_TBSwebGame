begin;

alter table public.matches
  add column if not exists resolve_ack_p1 boolean not null default false,
  add column if not exists resolve_ack_p2 boolean not null default false;

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
  v_prev_p1_row integer;
  v_prev_p1_col integer;
  v_prev_p2_row integer;
  v_prev_p2_col integer;
  v_steps integer;
  v_collision boolean := false;
  v_collision_row numeric := null;
  v_collision_col numeric := null;
  v_collision_step integer := null;
  v_collision_t numeric := null;
  v_hit_slot smallint := null;
  v_next_p1_hp integer;
  v_next_p2_hp integer;
  v_next_status text;
  v_next_winner_slot smallint;
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

  select coalesce((
    select t.action_payload -> 'path'
    from public.turns t
    where t.match_id = p_match_id
      and t.turn_number = v_round
      and t.player_slot = 1
    limit 1
  ), '[]'::jsonb)
  into v_path1;

  select coalesce((
    select t.action_payload -> 'path'
    from public.turns t
    where t.match_id = p_match_id
      and t.turn_number = v_round
      and t.player_slot = 2
    limit 1
  ), '[]'::jsonb)
  into v_path2;

  v_p1_row := (v_match.board_state -> 'p1' ->> 0)::integer;
  v_p1_col := (v_match.board_state -> 'p1' ->> 1)::integer;
  v_p2_row := (v_match.board_state -> 'p2' ->> 0)::integer;
  v_p2_col := (v_match.board_state -> 'p2' ->> 1)::integer;

  v_steps := greatest(jsonb_array_length(v_path1), jsonb_array_length(v_path2));
  if v_steps > 0 then
    for i in 0..(v_steps - 1) loop
      v_prev_p1_row := v_p1_row;
      v_prev_p1_col := v_p1_col;
      v_prev_p2_row := v_p2_row;
      v_prev_p2_col := v_p2_col;

      if i < jsonb_array_length(v_path1) then
        v_p1_row := (v_path1 -> i ->> 0)::integer;
        v_p1_col := (v_path1 -> i ->> 1)::integer;
      end if;
      if i < jsonb_array_length(v_path2) then
        v_p2_row := (v_path2 -> i ->> 0)::integer;
        v_p2_col := (v_path2 -> i ->> 1)::integer;
      end if;
      if not v_collision then
        if v_p1_row = v_p2_row and v_p1_col = v_p2_col then
          v_collision := true;
          v_collision_row := v_p1_row::numeric;
          v_collision_col := v_p1_col::numeric;
          v_collision_step := i;
          v_collision_t := 1;
        elsif v_prev_p1_row = v_p2_row
          and v_prev_p1_col = v_p2_col
          and v_prev_p2_row = v_p1_row
          and v_prev_p2_col = v_p1_col then
          v_collision := true;
          v_collision_row := (v_prev_p1_row + v_p1_row)::numeric / 2;
          v_collision_col := (v_prev_p1_col + v_p1_col)::numeric / 2;
          v_collision_step := i;
          v_collision_t := 0.5;
        end if;
      end if;
    end loop;
  end if;

  v_next_p1_hp := v_match.p1_hp;
  v_next_p2_hp := v_match.p2_hp;

  if v_collision then
    if v_match.attacker_slot = 1 then
      v_hit_slot := 2;
      v_next_p2_hp := greatest(v_match.p2_hp - 1, 0);
    else
      v_hit_slot := 1;
      v_next_p1_hp := greatest(v_match.p1_hp - 1, 0);
    end if;
  end if;

  v_next_status := 'active';
  v_next_winner_slot := null;

  if v_next_p1_hp <= 0 then
    v_next_status := 'finished';
    v_next_winner_slot := 2;
  elsif v_next_p2_hp <= 0 then
    v_next_status := 'finished';
    v_next_winner_slot := 1;
  end if;

  update public.matches
  set board_state = jsonb_build_object(
        'p1', jsonb_build_array(v_p1_row, v_p1_col),
        'p2', jsonb_build_array(v_p2_row, v_p2_col)
      ),
      p1_hp = v_next_p1_hp,
      p2_hp = v_next_p2_hp,
      status = v_next_status,
      winner_slot = v_next_winner_slot,
      ended_reason = case when v_next_status = 'finished' then 'normal' else ended_reason end,
      ended_at = case when v_next_status = 'finished' then now() else ended_at end,
      phase = 'resolving',
      planning_ends_at = null,
      resolution_ends_at = now() + greatest(
        (greatest(v_steps, 1) * interval '320 milliseconds') + interval '2200 milliseconds',
        interval '3000 milliseconds'
      ),
      resolve_ack_p1 = false,
      resolve_ack_p2 = false,
      resolved_paths = jsonb_build_object(
        'turn', v_round,
        'start', jsonb_build_object(
          'p1', v_match.board_state -> 'p1',
          'p2', v_match.board_state -> 'p2'
        ),
        'p1', v_path1,
        'p2', v_path2,
        'collision', v_collision,
        'hit_slot', v_hit_slot,
        'collision_step', v_collision_step,
        'collision_t', v_collision_t,
        'collision_at',
          case
            when v_collision_row is null then null
            else jsonb_build_array(v_collision_row, v_collision_col)
          end
      )
  where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;

create or replace function public.ack_resolve(p_match_id uuid, p_turn integer)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_slot smallint;
  v_match public.matches%rowtype;
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
    return v_match;
  end if;
  if v_match.phase <> 'resolving' then
    raise exception 'Not resolving';
  end if;
  if p_turn <> v_match.current_turn then
    raise exception 'Stale round';
  end if;

  update public.matches
  set resolve_ack_p1 = case when v_slot = 1 then true else resolve_ack_p1 end,
      resolve_ack_p2 = case when v_slot = 2 then true else resolve_ack_p2 end
  where id = p_match_id
  returning * into v_match;

  if coalesce(v_match.resolve_ack_p1, false) and coalesce(v_match.resolve_ack_p2, false) then
    update public.matches
    set phase = 'planning',
        current_turn = current_turn + 1,
        attacker_slot = case when attacker_slot = 1 then 2 else 1 end,
        planning_ends_at = now() + interval '10 seconds',
        resolution_ends_at = null,
        resolve_ack_p1 = false,
        resolve_ack_p2 = false,
        resolved_paths = null
    where id = p_match_id
    returning * into v_match;
  end if;

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
        phase = 'planning',
        planning_ends_at = coalesce(planning_ends_at, now() + interval '10 seconds'),
        resolution_ends_at = null,
        resolved_paths = null,
        p1_hp = coalesce(p1_hp, 3),
        p2_hp = coalesce(p2_hp, 3),
        attacker_slot = coalesce(attacker_slot, 1)
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
    if (coalesce(v_match.resolve_ack_p1, false) and coalesce(v_match.resolve_ack_p2, false))
       or (v_match.resolution_ends_at is not null and now() >= v_match.resolution_ends_at) then
      update public.matches
      set phase = 'planning',
          current_turn = current_turn + 1,
          attacker_slot = case when attacker_slot = 1 then 2 else 1 end,
          planning_ends_at = now() + interval '10 seconds',
          resolution_ends_at = null,
          resolve_ack_p1 = false,
          resolve_ack_p2 = false,
          resolved_paths = null
      where id = p_match_id
      returning * into v_match;
    end if;
    return v_match;
  end if;

  return v_match;
end;
$$;

revoke execute on function public.start_resolving_round(uuid) from public;
revoke execute on function public.ack_resolve(uuid, integer) from public;
revoke execute on function public.tick_match_round(uuid) from public;
grant execute on function public.start_resolving_round(uuid) to authenticated;
grant execute on function public.ack_resolve(uuid, integer) to authenticated;
grant execute on function public.tick_match_round(uuid) to authenticated;

commit;

