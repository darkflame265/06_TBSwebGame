begin;

create or replace function public.get_user_match_stats(p_user_ids uuid[])
returns table (
  user_id uuid,
  wins integer,
  losses integer,
  win_rate integer
)
language sql
security definer
set search_path = public
as $$
  with target_users as (
    select distinct unnest(coalesce(p_user_ids, '{}'::uuid[])) as user_id
  ),
  aggregated as (
    select
      mp.user_id,
      sum(case when m.winner_slot = mp.slot then 1 else 0 end)::integer as wins,
      sum(case when m.winner_slot <> mp.slot then 1 else 0 end)::integer as losses
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id in (select user_id from target_users)
      and m.status = 'finished'
      and m.winner_slot is not null
      and m.type <> 'ai'
    group by mp.user_id
  )
  select
    t.user_id,
    coalesce(a.wins, 0) as wins,
    coalesce(a.losses, 0) as losses,
    case
      when coalesce(a.wins, 0) + coalesce(a.losses, 0) = 0 then 0
      else round((coalesce(a.wins, 0)::numeric * 100) / (coalesce(a.wins, 0) + coalesce(a.losses, 0)))::integer
    end as win_rate
  from target_users t
  left join aggregated a on a.user_id = t.user_id;
$$;

revoke execute on function public.get_user_match_stats(uuid[]) from public;
grant execute on function public.get_user_match_stats(uuid[]) to authenticated;

commit;

