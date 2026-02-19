begin;

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
    -- 8-char uppercase code without relying on gen_random_bytes()
    v_room_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1
      from public.matches m
      where m.room_code = v_room_code
    );
  end loop;

  insert into public.matches (type, status, room_code, created_by)
  values ('friend', 'waiting', v_room_code, v_user)
  returning id into v_match_id;

  insert into public.match_players (match_id, user_id, slot)
  values (v_match_id, v_user, 1);

  return query select v_match_id, v_room_code;
end;
$$;

revoke execute on function public.create_friend_match() from public;
grant execute on function public.create_friend_match() to authenticated;

commit;

