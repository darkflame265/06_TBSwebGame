begin;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(trim(nickname)) between 2 and 24),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

grant select, insert, update on public.user_profiles to authenticated;

alter table public.user_profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.user_profiles;
create policy "profiles_select_authenticated"
on public.user_profiles
for select
to authenticated
using (true);

drop policy if exists "profiles_insert_self" on public.user_profiles;
create policy "profiles_insert_self"
on public.user_profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "profiles_update_self" on public.user_profiles;
create policy "profiles_update_self"
on public.user_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

commit;

