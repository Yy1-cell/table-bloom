-- "New friends I'd eat with again": people I marked "again" in a post-meal check-in.
-- Private to me. "mutual" is true only when that person also marked ME "again" at the same table,
-- so nobody ever learns that someone did NOT pick them. Blocked pairs are left out. Safe to re-run.
create or replace function public.list_again_people() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select jsonb_agg(q.x order by q.x->>'last_at' desc)
    from (
      select jsonb_build_object(
               'user_id', s.to_user,
               'display_name', p.display_name,
               'avatar_emoji', p.avatar_emoji,
               'times', count(*),
               'last_at', max(t.starts_at),
               'last_title', (array_agg(t.title order by t.starts_at desc))[1],
               'mutual', bool_or(exists (
                   select 1 from public.peer_signals r
                    where r.table_id = s.table_id and r.from_user = s.to_user and r.to_user = me and r.signal = 'again'))
             ) as x
        from public.peer_signals s
        join public.profiles p on p.id = s.to_user
        join public.dining_tables t on t.id = s.table_id
       where s.from_user = me and s.signal = 'again'
         and p.status <> 'suspended'
         and not public.is_blocked_pair(me, s.to_user)
       group by s.to_user, p.display_name, p.avatar_emoji
    ) q
  ), '[]'::jsonb);
end $$;

revoke all on function public.list_again_people() from public, anon;
grant execute on function public.list_again_people() to authenticated;
