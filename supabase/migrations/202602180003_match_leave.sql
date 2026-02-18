begin;

alter table public.matches
  add column if not exists ended_reason text check (ended_reason in ('player_left', 'normal')),
  add column if not exists left_by uuid references auth.users(id);

create or replace function public.leave_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_my_slot smallint;
  v_opponent_slot smallint;
  v_match public.matches%rowtype;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  select mp.slot
    into v_my_slot
  from public.match_players mp
  where mp.match_id = p_match_id
    and mp.user_id = v_user;

  if v_my_slot is null then
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

  if v_match.status = 'finished' then
    return v_match;
  end if;

  select mp.slot
    into v_opponent_slot
  from public.match_players mp
  where mp.match_id = p_match_id
    and mp.user_id <> v_user
  limit 1;

  update public.matches
  set status = 'finished',
      ended_at = now(),
      ended_reason = 'player_left',
      left_by = v_user,
      winner_slot = v_opponent_slot
  where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;

revoke execute on function public.leave_match(uuid) from public;
grant execute on function public.leave_match(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end
$$;

commit;
