begin;

create extension if not exists pgcrypto;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('friend', 'random')),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished')),
  room_code text unique,
  created_by uuid not null references auth.users(id),
  current_turn integer not null default 1,
  current_player_slot smallint not null default 1 check (current_player_slot in (1, 2)),
  winner_slot smallint check (winner_slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, slot)
);

create table if not exists public.turns (
  id bigserial primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  turn_number integer not null check (turn_number > 0),
  player_slot smallint not null check (player_slot in (1, 2)),
  action_payload jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (match_id, turn_number)
);

create table if not exists public.matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now()
);

create index if not exists idx_matches_room_code on public.matches(room_code);
create index if not exists idx_matches_status on public.matches(status);
create index if not exists idx_match_players_user_id on public.match_players(user_id);
create index if not exists idx_turns_match_id_created_at on public.turns(match_id, created_at desc);
create index if not exists idx_matchmaking_queue_joined_at on public.matchmaking_queue(joined_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_matches_updated_at on public.matches;
create trigger trg_matches_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

create or replace function public.is_match_player(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.match_players mp
    where mp.match_id = p_match_id
      and mp.user_id = auth.uid()
  );
$$;

create or replace function public.create_friend_match()
returns table (match_id uuid, room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match_id uuid;
  v_room_code text;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  loop
    v_room_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
    exit when not exists (select 1 from public.matches m where m.room_code = v_room_code);
  end loop;

  insert into public.matches (type, status, room_code, created_by)
  values ('friend', 'waiting', v_room_code, v_user)
  returning id into v_match_id;

  insert into public.match_players (match_id, user_id, slot)
  values (v_match_id, v_user, 1);

  return query select v_match_id, v_room_code;
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
      current_player_slot = 1
  where id = v_match_id;

  return query select v_match_id;
end;
$$;

create or replace function public.join_matchmaking_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_opponent uuid;
  v_match_id uuid;
  v_my_slot smallint;
  v_other_slot smallint;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  insert into public.matchmaking_queue (user_id, joined_at)
  values (v_user, now())
  on conflict (user_id) do update set joined_at = excluded.joined_at;

  select q.user_id
    into v_opponent
  from public.matchmaking_queue q
  where q.user_id <> v_user
  order by q.joined_at asc
  limit 1
  for update skip locked;

  if v_opponent is null then
    return jsonb_build_object('status', 'queued');
  end if;

  delete from public.matchmaking_queue
  where user_id in (v_user, v_opponent);

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
         (v_match_id, v_opponent, v_other_slot);

  return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
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
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  select mp.slot into v_slot
  from public.match_players mp
  where mp.match_id = p_match_id
    and mp.user_id = v_user;

  if v_slot is null then
    raise exception 'You are not part of this match';
  end if;

  select * into v_match
  from public.matches m
  where m.id = p_match_id
  for update;

  if v_match.id is null then
    raise exception 'Match not found';
  end if;

  if v_match.status <> 'active' then
    raise exception 'Match is not active';
  end if;

  if v_match.current_player_slot <> v_slot then
    raise exception 'Not your turn';
  end if;

  insert into public.turns (match_id, turn_number, player_slot, action_payload, created_by)
  values (p_match_id, v_match.current_turn, v_slot, p_action, v_user)
  returning * into v_new_turn;

  update public.matches
  set current_turn = current_turn + 1,
      current_player_slot = case when current_player_slot = 1 then 2 else 1 end
  where id = p_match_id;

  return v_new_turn;
exception
  when unique_violation then
    raise exception 'Turn already submitted';
end;
$$;

revoke execute on function public.create_friend_match() from public;
revoke execute on function public.join_friend_match(text) from public;
revoke execute on function public.join_matchmaking_queue() from public;
revoke execute on function public.submit_turn(uuid, jsonb) from public;
revoke execute on function public.is_match_player(uuid) from public;

grant usage on schema public to anon, authenticated;
grant select on public.matches to anon, authenticated;
grant select on public.match_players to anon, authenticated;
grant select on public.turns to anon, authenticated;
grant select, insert, update, delete on public.matchmaking_queue to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.create_friend_match() to authenticated;
grant execute on function public.join_friend_match(text) to authenticated;
grant execute on function public.join_matchmaking_queue() to authenticated;
grant execute on function public.submit_turn(uuid, jsonb) to authenticated;
grant execute on function public.is_match_player(uuid) to authenticated;

alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.turns enable row level security;
alter table public.matchmaking_queue enable row level security;

drop policy if exists "matches_select_participants" on public.matches;
create policy "matches_select_participants"
on public.matches
for select
to authenticated
using (public.is_match_player(id));

drop policy if exists "match_players_select_participants" on public.match_players;
create policy "match_players_select_participants"
on public.match_players
for select
to authenticated
using (public.is_match_player(match_id));

drop policy if exists "turns_select_participants" on public.turns;
create policy "turns_select_participants"
on public.turns
for select
to authenticated
using (public.is_match_player(match_id));

drop policy if exists "queue_select_self" on public.matchmaking_queue;
create policy "queue_select_self"
on public.matchmaking_queue
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "queue_insert_self" on public.matchmaking_queue;
create policy "queue_insert_self"
on public.matchmaking_queue
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "queue_update_self" on public.matchmaking_queue;
create policy "queue_update_self"
on public.matchmaking_queue
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "queue_delete_self" on public.matchmaking_queue;
create policy "queue_delete_self"
on public.matchmaking_queue
for delete
to authenticated
using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'turns'
  ) then
    alter publication supabase_realtime add table public.turns;
  end if;
end
$$;

commit;
