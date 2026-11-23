-- People the host removed can't rejoin on their own (request_join refuses them). The host can let them back in:
-- that clears the "removed" record, so the invitation link works for them again.
create or replace function public.list_removed(p_table uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.dining_tables where id = p_table and host_id = me) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji))
      from public.table_members m join public.profiles p on p.id = m.user_id
     where m.table_id = p_table and m.status = 'removed'
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_removed(uuid) from public, anon;
grant execute on function public.list_removed(uuid) to authenticated;

create or replace function public.allow_back(p_table uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.dining_tables where id = p_table and host_id = me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.table_members where table_id = p_table and user_id = p_user and status in ('removed', 'declined');
end $$;
revoke all on function public.allow_back(uuid, uuid) from public, anon;
grant execute on function public.allow_back(uuid, uuid) to authenticated;
