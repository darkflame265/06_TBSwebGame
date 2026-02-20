begin;

create table if not exists public.match_chat_messages (
  id bigserial primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists idx_match_chat_messages_match_created
  on public.match_chat_messages (match_id, created_at);

grant select, insert on public.match_chat_messages to authenticated;

alter table public.match_chat_messages enable row level security;

drop policy if exists "match_chat_select_member" on public.match_chat_messages;
create policy "match_chat_select_member"
on public.match_chat_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.match_players mp
    where mp.match_id = match_chat_messages.match_id
      and mp.user_id = auth.uid()
  )
);

drop policy if exists "match_chat_insert_member" on public.match_chat_messages;
create policy "match_chat_insert_member"
on public.match_chat_messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.match_players mp
    where mp.match_id = match_chat_messages.match_id
      and mp.user_id = auth.uid()
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'match_chat_messages'
  ) then
    alter publication supabase_realtime add table public.match_chat_messages;
  end if;
end;
$$;

commit;
