-- The host can change the number of seats while the table is still live (e.g. a friend brings someone).
-- It can't go below the number of people already in, or above 12; a full table opens again when seats are added.
create or replace function public.set_capacity(p_table uuid, p_capacity int) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  t public.dining_tables;
  taken int;
begin
  select * into t from public.dining_tables where id = p_table for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.host_id is distinct from me then raise exception 'not_allowed' using errcode = '42501'; end if;
  if t.status in ('cancelled', 'completed') then raise exception 'not_allowed' using errcode = '42501'; end if;
  select count(*) into taken from public.table_members where table_id = p_table and status = 'joined';
  if p_capacity is null or p_capacity < greatest(2, taken) or p_capacity > 12 then
    raise exception 'bad_capacity' using errcode = '22023';
  end if;
  update public.dining_tables set capacity = p_capacity where id = p_table;
  perform public.refresh_table_status(p_table);
end $$;
revoke all on function public.set_capacity(uuid, int) from public, anon;
grant execute on function public.set_capacity(uuid, int) to authenticated;
