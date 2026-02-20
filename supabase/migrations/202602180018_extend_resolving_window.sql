begin;

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
      -- Keep resolving window long enough for 2s path preview + movement.
      resolution_ends_at = now() + greatest(
        (greatest(v_steps, 1) * interval '320 milliseconds') + interval '2200 milliseconds',
        interval '3000 milliseconds'
      ),
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

revoke execute on function public.start_resolving_round(uuid) from public;
grant execute on function public.start_resolving_round(uuid) to authenticated;

commit;

