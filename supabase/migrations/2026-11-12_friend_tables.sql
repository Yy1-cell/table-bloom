-- Friend tables (minimal version). Safe to run more than once.
-- Run this in the Supabase SQL Editor BEFORE deploying the matching app update.
--   * "Friends" tables become private: not listed in Discover, joined with an invite link.
--   * Every member can say what they feel like eating.
--   * At a private table, joined members see each other's starting point and craving.
--   * At a private table, any joined member can pick the restaurant.

alter table public.dining_tables add column if not exists is_private boolean not null default false;
alter table public.table_members add column if not exists cuisine_slug text references public.cuisines(slug);

create or replace function public.table_json(t public.dining_tables, me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id,
    'host_id', t.host_id,
    'host', case
      when t.host_id is not null then
        (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji,
                                   'languages_spoken', to_jsonb(p.languages_spoken), 'no_show_count', p.no_show_count)
           from public.profiles p where p.id = t.host_id)
      else jsonb_build_object('id', null, 'display_name', t.sample_host_name, 'avatar_emoji', t.sample_host_emoji,
                              'languages_spoken', '[]'::jsonb, 'no_show_count', 0)
    end,
    'area_id', t.area_id,
    'title', t.title,
    'audience', t.audience,
    'starts_at', t.starts_at,
    'capacity', t.capacity,
    'budget_cents', t.budget_cents,
    'cuisine', t.cuisine_slug,
    'venue', (select jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address, 'lat', v.latitude, 'lng', v.longitude)
                from public.venues v where v.id = t.venue_id),
    'area_label', t.area_label,
    'meet_lat', t.meet_lat,
    'meet_lng', t.meet_lng,
    'tags', to_jsonb(t.tags),
    'note', t.note,
    'join_mode', t.join_mode,
    'status', t.status,
    'is_sample', t.is_sample,
    'is_private', t.is_private,
    'seats_taken', case when t.is_sample then coalesce(t.sample_seats, 1)
                        else (select count(*) from public.table_members m where m.table_id = t.id and m.status = 'joined') end,
    'pending_count', case when t.host_id = me
                          then (select count(*) from public.table_members m where m.table_id = t.id and m.status = 'requested')
                          else 0 end,
    'my_status', (select case when m.role = 'host' and m.status = 'joined' then 'host' else m.status end
                    from public.table_members m where m.table_id = t.id and m.user_id = me),
    'created_at', t.created_at
  );
$$;

create or replace function public.list_tables(p_area uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select jsonb_agg(public.table_json(t, me) order by t.starts_at)
      from public.dining_tables t
     where t.status in ('open', 'full')
       and not t.is_private
       and t.starts_at > now() - interval '1 hour'
       and (p_area is null or t.area_id = p_area)
       and (t.host_id is null or t.host_id = me or not public.is_blocked_pair(me, t.host_id))
  ), '[]'::jsonb);
end $$;

create or replace function public.get_table(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  t public.dining_tables;
  is_host boolean;
  can_see boolean;
  members jsonb;
  mine jsonb;
begin
  select * into t from public.dining_tables where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.host_id is not null and t.host_id <> me and public.is_blocked_pair(me, t.host_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  is_host := (t.host_id = me);
  -- On a private friend table, everyone who has joined can see each other's starting point and craving.
  can_see := is_host or exists (select 1 from public.table_members x where x.table_id = p_id and x.user_id = me and x.status = 'joined');

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'role', m.role,
           'status', m.status,
           'display_name', p.display_name,
           'avatar_emoji', p.avatar_emoji,
           'no_show_count', case when is_host then p.no_show_count else null end,
           -- start points are visible to the host (to suggest a fair meeting point), to the person themselves,
           -- and to everyone at a private friend table they have joined
           'start_label', case when is_host or m.user_id = me or (t.is_private and can_see) then m.start_label end,
           'start_lat', case when is_host or m.user_id = me or (t.is_private and can_see) then m.start_lat end,
           'start_lng', case when is_host or m.user_id = me or (t.is_private and can_see) then m.start_lng end,
           'cuisine', case when is_host or m.user_id = me or (t.is_private and can_see) then m.cuisine_slug end
         ) order by m.joined_at nulls last, m.requested_at), '[]'::jsonb)
    into members
    from public.table_members m
    join public.profiles p on p.id = m.user_id
   where m.table_id = p_id
     and ((m.status = 'joined' and (not t.is_private or can_see)) or (is_host and m.status = 'requested') or m.user_id = me)
     and (m.user_id = me or not public.is_blocked_pair(me, m.user_id));

  select jsonb_build_object('start_label', m.start_label, 'start_lat', m.start_lat, 'start_lng', m.start_lng,
                            'intention', m.intention, 'pace', m.pace, 'cuisine', m.cuisine_slug)
    into mine
    from public.table_members m where m.table_id = p_id and m.user_id = me;

  return public.table_json(t, me) || jsonb_build_object('members', members, 'my_membership', coalesce(mine, 'null'::jsonb));
end $$;

create or replace function public.create_table(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  v_starts timestamptz := (p->>'starts_at')::timestamptz;
  v_cap int := (p->>'capacity')::int;
  v_venue uuid := null;
  v_id uuid;
  v_tags text[];
  v_title text := nullif(btrim(coalesce(p->>'title', '')), '');
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  -- "Friends" tables are private: invite link only, anyone with the link joins straight away.
  v_private boolean := coalesce(p->>'audience', 'friends_and_new') = 'friends';
begin
  if v_starts is null or v_starts < now() then raise exception 'start_in_past' using errcode = '22023'; end if;
  if v_cap is null or v_cap < 2 or v_cap > 12 then raise exception 'bad_capacity' using errcode = '22023'; end if;
  if (select count(*) from public.dining_tables where host_id = me and created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  select coalesce(array_agg(x), '{}') into v_tags from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) x;

  if p->'venue' is not null and jsonb_typeof(p->'venue') = 'object' and nullif(btrim(p->'venue'->>'name'), '') is not null then
    insert into public.venues (name, address, latitude, longitude, map_poi_id, cuisine_slug, created_by)
    values (left(p->'venue'->>'name', 120), left(p->'venue'->>'address', 240),
            nullif(p->'venue'->>'lat', '')::numeric, nullif(p->'venue'->>'lng', '')::numeric,
            p->'venue'->>'poi_id', nullif(p->>'cuisine', ''), me)
    returning id into v_venue;
  end if;

  insert into public.dining_tables (host_id, area_id, title, audience, starts_at, capacity, budget_cents, cuisine_slug,
                                    venue_id, area_label, meet_lat, meet_lng, tags, note, join_mode, is_private)
  values (me, nullif(p->>'area_id', '')::uuid, v_title, coalesce(p->>'audience', 'friends_and_new'), v_starts, v_cap,
          nullif(p->>'budget_cents', '')::int, nullif(p->>'cuisine', ''), v_venue, left(p->>'area_label', 120),
          nullif(p->>'meet_lat', '')::numeric, nullif(p->>'meet_lng', '')::numeric, v_tags, v_note,
          case when v_private then 'instant' else coalesce(p->>'join_mode', 'request') end, v_private)
  returning id into v_id;

  insert into public.table_members (table_id, user_id, role, status, joined_at, intention, pace)
  values (v_id, me, 'host', 'joined', now(), nullif(p->>'intention', ''), nullif(p->>'pace', ''));

  perform public.refresh_table_status(v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.set_venue(p_table uuid, p_venue jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); t public.dining_tables; v_id uuid;
begin
  select * into t from public.dining_tables where id = p_table;
  -- The host can always pick the place. At a private friend table, every joined member can.
  if not found or (t.host_id is distinct from me and not (t.is_private and exists (
       select 1 from public.table_members x where x.table_id = p_table and x.user_id = me and x.status = 'joined'))) then
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
end $$;

create or replace function public.set_my_craving(p_table uuid, p_cuisine text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  update public.table_members set cuisine_slug = nullif(p_cuisine, '')
   where table_id = p_table and user_id = me and status in ('requested', 'joined');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.set_my_craving(uuid, text) from public, anon;
grant execute on function public.set_my_craving(uuid, text) to authenticated;
