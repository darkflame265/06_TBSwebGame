begin;

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
  v_first_round_deadline timestamptz;
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

    -- First round only: extend planning window to 15s from started_at.
    -- Fixed absolute deadline avoids progress-bar refill jitter.
    if v_match.current_turn = 1 and v_match.started_at is not null then
      v_first_round_deadline := v_match.started_at + interval '15 seconds';
      if now() < v_first_round_deadline
         and (v_match.planning_ends_at is null or v_match.planning_ends_at < v_first_round_deadline) then
        update public.matches
        set planning_ends_at = v_first_round_deadline
        where id = p_match_id
        returning * into v_match;
      end if;
    end if;

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

revoke execute on function public.tick_match_round(uuid) from public;
grant execute on function public.tick_match_round(uuid) to authenticated;

commit;
