begin;

alter table public.matches
  add column if not exists rematch_p1_requested boolean not null default false,
  add column if not exists rematch_p2_requested boolean not null default false,
  add column if not exists rematch_match_id uuid references public.matches(id);

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

revoke execute on function public.request_rematch(uuid) from public;
grant execute on function public.request_rematch(uuid) to authenticated;

commit;
