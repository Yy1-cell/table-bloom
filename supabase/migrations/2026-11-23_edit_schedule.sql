-- Host can change the date/time and the note of a table before the meal; members see "Time changed: 19:30 -> 20:00".
alter table public.dining_tables
  add column if not exists prev_starts_at timestamptz,
  add column if not exists schedule_changed_at timestamptz;

create or replace function public.set_schedule(p_table uuid, p_starts_at timestamptz, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  t public.dining_tables;
begin
  select * into t from public.dining_tables where id = p_table for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.host_id is distinct from me then raise exception 'not_allowed' using errcode = '42501'; end if;
  if t.status in ('cancelled', 'completed') or t.starts_at <= now() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'bad_time' using errcode = '22023'; end if;
  update public.dining_tables
     set prev_starts_at = case when p_starts_at <> t.starts_at then t.starts_at else prev_starts_at end,
         schedule_changed_at = case when p_starts_at <> t.starts_at then now() else schedule_changed_at end,
         starts_at = p_starts_at,
         note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_table;
end $$;
revoke all on function public.set_schedule(uuid, timestamptz, text) from public, anon;
grant execute on function public.set_schedule(uuid, timestamptz, text) to authenticated;

-- What the time was before the last change (for the host and people at the table only).
create or replace function public.schedule_change(p_table uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  t public.dining_tables;
begin
  select * into t from public.dining_tables where id = p_table;
  if not found or t.schedule_changed_at is null then return null; end if;
  if t.host_id <> me and not exists (select 1 from public.table_members m where m.table_id = p_table and m.user_id = me and m.status in ('joined', 'requested')) then
    return null;
  end if;
  return jsonb_build_object('prev_starts_at', t.prev_starts_at, 'changed_at', t.schedule_changed_at);
end $$;
revoke all on function public.schedule_change(uuid) from public, anon;
grant execute on function public.schedule_change(uuid) to authenticated;
