-- Friends tables: friends propose places, the host decides.
-- 1) Only the host can set the place (friends used to be able to change it directly).
-- 2) Each member can have one proposal at a time; everyone at the table sees them; choosing a place clears them.
alter table public.table_members
  add column if not exists proposal jsonb,
  add column if not exists proposed_at timestamptz;

create or replace function public.set_venue(p_table uuid, p_venue jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); t public.dining_tables; v_id uuid;
begin
  select * into t from public.dining_tables where id = p_table;
  if not found or t.host_id is distinct from me then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_venue->>'name'), '') is null then raise exception 'bad_venue' using errcode = '22023'; end if;
  insert into public.venues (name, address, latitude, longitude, map_poi_id, cuisine_slug, created_by)
  values (left(p_venue->>'name', 120), left(p_venue->>'address', 240),
          nullif(p_venue->>'lat', '')::numeric, nullif(p_venue->>'lng', '')::numeric,
          p_venue->>'poi_id', t.cuisine_slug, me)
  returning id into v_id;
  update public.dining_tables
     set venue_id = v_id,
         area_label = coalesce(left(p_venue->>'name', 120), area_label),
         meet_lat = coalesce(nullif(p_venue->>'lat', '')::numeric, meet_lat),
         meet_lng = coalesce(nullif(p_venue->>'lng', '')::numeric, meet_lng)
   where id = p_table;
  update public.table_members set proposal = null, proposed_at = null where table_id = p_table and proposal is not null;
end $$;

create or replace function public.propose_venue(p_table uuid, p_venue jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); t public.dining_tables;
begin
  select * into t from public.dining_tables where id = p_table;
  if not found or not t.is_private or t.status in ('cancelled', 'completed') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_venue is not null and nullif(btrim(p_venue->>'name'), '') is null then raise exception 'bad_venue' using errcode = '22023'; end if;
  update public.table_members
     set proposal = case when p_venue is null then null else jsonb_build_object(
           'name', left(p_venue->>'name', 120), 'address', left(p_venue->>'address', 240),
           'lat', nullif(p_venue->>'lat', '')::numeric, 'lng', nullif(p_venue->>'lng', '')::numeric, 'poi_id', p_venue->>'poi_id') end,
         proposed_at = case when p_venue is null then null else now() end
   where table_id = p_table and user_id = me and status = 'joined';
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
end $$;
revoke all on function public.propose_venue(uuid, jsonb) from public, anon;
grant execute on function public.propose_venue(uuid, jsonb) to authenticated;

create or replace function public.list_proposals(p_table uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.table_members x where x.table_id = p_table and x.user_id = me and x.status = 'joined')
     and not exists (select 1 from public.dining_tables d where d.id = p_table and d.host_id = me) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji,
                                        'venue', m.proposal, 'proposed_at', m.proposed_at) order by m.proposed_at)
      from public.table_members m join public.profiles p on p.id = m.user_id
     where m.table_id = p_table and m.status = 'joined' and m.proposal is not null
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_proposals(uuid) from public, anon;
grant execute on function public.list_proposals(uuid) to authenticated;
