-- 2026-11-24 Communities + safety
--  * dining_tables.community: one optional community per public table
--      newcomers · mandarin · slow · lgbtq (all open to everyone) · women (women incl. trans women + non-binary; host approval always)
--  * Tables with strangers (public tables) need:
--      - a signed-in account (email / Google), not a guest   -> 'login_needed'
--      - the code of conduct agreed once (profiles.conduct_at) -> 'conduct_needed'
--      - a real restaurant from search (Google / OpenStreetMap / City of Toronto list) -> 'real_place_needed'
--      - at least 3 seats                                     -> 'bad_capacity'
--    Friends tables (invite link only) are not affected.
--  * Public tables: nobody sees another person's starting point, not even the host.
--  * Post-meal private safety question (safety_checks). A "no" also files a report for the admin.
-- Safe to run more than once.

alter table public.dining_tables add column if not exists community text;
alter table public.dining_tables drop constraint if exists dining_tables_community_chk;
alter table public.dining_tables add constraint dining_tables_community_chk
  check (community is null or community in ('newcomers', 'mandarin', 'slow', 'lgbtq', 'women'));
alter table public.profiles add column if not exists conduct_at timestamptz;

create table if not exists public.safety_checks (
  table_id uuid not null references public.dining_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer text not null check (answer in ('yes', 'unsure', 'no')),
  created_at timestamptz not null default now(),
  primary key (table_id, user_id)
);
alter table public.safety_checks enable row level security;
revoke all on public.safety_checks from anon, authenticated;

-- A guest = an anonymous sign-in (no email, no Google).
create or replace function public.is_guest(u uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select au.is_anonymous from auth.users au where au.id = u), false);
$$;
revoke all on function public.is_guest(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- rules on tables
create or replace function public.tables_safety_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare poi text;
begin
  if new.is_sample then return new; end if;
  if new.is_private then
    new.community := null;
    return new;
  end if;
  if new.community = 'women' then new.join_mode := 'request'; end if;
  if tg_op = 'INSERT' then
    if public.is_guest(new.host_id) then raise exception 'login_needed' using errcode = '42501'; end if;
    if not exists (select 1 from public.profiles where id = new.host_id and conduct_at is not null) then
      raise exception 'conduct_needed' using errcode = '42501';
    end if;
    if new.venue_id is null then raise exception 'real_place_needed' using errcode = '22023'; end if;
  end if;
  if (tg_op = 'INSERT' or new.capacity is distinct from old.capacity) and new.capacity < 3 then
    raise exception 'bad_capacity' using errcode = '22023';
  end if;
  if new.venue_id is not null and (tg_op = 'INSERT' or new.venue_id is distinct from old.venue_id) then
    select map_poi_id into poi from public.venues where id = new.venue_id;
    if coalesce(poi, '') !~ '^(g:.+|d:.+|[NWR][0-9]+)$' then
      raise exception 'real_place_needed' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists dining_tables_safety on public.dining_tables;
create trigger dining_tables_safety before insert or update on public.dining_tables
  for each row execute function public.tables_safety_guard();

-- ---------------------------------------------------------------- rules on joining
create or replace function public.members_safety_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.dining_tables;
begin
  if new.role = 'host' or new.status not in ('requested', 'joined') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('requested', 'joined') then return new; end if;
  select * into t from public.dining_tables where id = new.table_id;
  if not found or t.is_private or t.is_sample then return new; end if;
  if public.is_guest(new.user_id) then raise exception 'login_needed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = new.user_id and conduct_at is not null) then
    raise exception 'conduct_needed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists table_members_safety on public.table_members;
create trigger table_members_safety before insert or update on public.table_members
  for each row execute function public.members_safety_guard();

-- ---------------------------------------------------------------- code of conduct
create or replace function public.agree_conduct() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  update public.profiles set conduct_at = coalesce(conduct_at, now()) where id = me;
end $$;
revoke all on function public.agree_conduct() from public, anon;
grant execute on function public.agree_conduct() to authenticated;

-- ---------------------------------------------------------------- post-meal safety question (private)
create or replace function public.save_safety_check(p_table uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if p_answer not in ('yes', 'unsure', 'no') then raise exception 'bad_answer' using errcode = '22023'; end if;
  if not public.is_table_member(p_table, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.safety_checks (table_id, user_id, answer) values (p_table, me, p_answer)
  on conflict (table_id, user_id) do update set answer = excluded.answer, created_at = now();
  if p_answer = 'no' and not exists (select 1 from public.reports where reporter_id = me and table_id = p_table and reason = 'felt_unsafe') then
    insert into public.reports (reporter_id, table_id, reason, details)
    values (me, p_table, 'felt_unsafe', 'Post-meal check-in: did not feel safe at this table.');
  end if;
end $$;
revoke all on function public.save_safety_check(uuid, text) from public, anon;
grant execute on function public.save_safety_check(uuid, text) to authenticated;

create or replace function public.my_safety_check(p_table uuid) returns text
language sql stable security definer set search_path = public as $$
  select answer from public.safety_checks where table_id = p_table and user_id = auth.uid();
$$;
revoke all on function public.my_safety_check(uuid) from public, anon;
grant execute on function public.my_safety_check(uuid) to authenticated;

-- ---------------------------------------------------------------- create_table: + community
create or replace function public.create_table(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  me uuid := public.require_user();
  v_starts timestamptz := (p->>'starts_at')::timestamptz;
  v_cap int := (p->>'capacity')::int;
  v_venue uuid := null;
  v_id uuid;
  v_tags text[];
  v_formats text[];
  v_cuisines text[];
  v_vtype text := nullif(p->>'venue_type', '');
  v_cur text := upper(coalesce(nullif(btrim(p->>'currency'), ''), 'CAD'));
  v_title text := nullif(btrim(coalesce(p->>'title', '')), '');
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  -- "Friends" tables are private: invite link only, anyone with the link joins straight away.
  v_private boolean := coalesce(p->>'audience', 'friends_and_new') = 'friends';
  v_comm text := nullif(p->>'community', '');
begin
  if v_starts is null or v_starts < now() then raise exception 'start_in_past' using errcode = '22023'; end if;
  if v_cap is null or v_cap < 2 or v_cap > 12 then raise exception 'bad_capacity' using errcode = '22023'; end if;
  if (select count(*) from public.dining_tables where host_id = me and created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if v_private or v_comm not in ('newcomers', 'mandarin', 'slow', 'lgbtq', 'women') then v_comm := null; end if;

  select coalesce(array_agg(x), '{}') into v_tags from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) x;
  select coalesce(array_agg(f), '{}') into v_formats from (
    select distinct x as f from jsonb_array_elements_text(coalesce(p->'formats', '[]'::jsonb)) x
     where x in ('hotpot','bbq','dimsum','noodles','seafood','buffet','brunch','veg') limit 3
  ) s;
  select coalesce(array_agg(c order by o), '{}') into v_cuisines from (
    select x.c, min(x.o) o from jsonb_array_elements_text(
      coalesce(p->'cuisines', case when nullif(p->>'cuisine','') is not null then jsonb_build_array(p->>'cuisine') else '[]'::jsonb end)
    ) with ordinality as x(c, o)
    where exists (select 1 from public.cuisines k where k.slug = x.c) group by x.c order by min(x.o) limit 3
  ) s;
  if v_cur !~ '^[A-Z]{3}$' then v_cur := 'CAD'; end if;
  if v_vtype is not null and v_vtype not in ('fast','casual','dine','cafe','bar') then v_vtype := null; end if;

  if p->'venue' is not null and jsonb_typeof(p->'venue') = 'object' and nullif(btrim(p->'venue'->>'name'), '') is not null then
    insert into public.venues (name, address, latitude, longitude, map_poi_id, cuisine_slug, created_by)
    values (left(p->'venue'->>'name', 120), left(p->'venue'->>'address', 240),
            nullif(p->'venue'->>'lat', '')::numeric, nullif(p->'venue'->>'lng', '')::numeric,
            p->'venue'->>'poi_id', v_cuisines[1], me)
    returning id into v_venue;
  end if;

  insert into public.dining_tables (host_id, area_id, title, audience, starts_at, capacity, budget_cents, currency, cuisine_slug, cuisines, formats, venue_type,
                                    venue_id, area_label, meet_lat, meet_lng, tags, occasion, note, join_mode, is_private, community)
  values (me, nullif(p->>'area_id', '')::uuid, v_title, coalesce(p->>'audience', 'friends_and_new'), v_starts, v_cap,
          nullif(p->>'budget_cents', '')::int, v_cur, v_cuisines[1], v_cuisines, v_formats, v_vtype, v_venue, left(p->>'area_label', 120),
          nullif(p->>'meet_lat', '')::numeric, nullif(p->>'meet_lng', '')::numeric, v_tags, nullif(p->>'occasion', ''), v_note,
          case when v_private then 'instant' else coalesce(p->>'join_mode', 'request') end, v_private, v_comm)
  returning id into v_id;

  insert into public.table_members (table_id, user_id, role, status, joined_at, intention, pace)
  values (v_id, me, 'host', 'joined', now(), nullif(p->>'intention', ''), nullif(p->>'pace', ''));

  perform public.refresh_table_status(v_id);
  return jsonb_build_object('id', v_id);
end $function$;

-- ---------------------------------------------------------------- table_json: + community
create or replace function public.table_json(t public.dining_tables, me uuid) returns jsonb
language sql stable security definer set search_path = public as $function$
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
    'currency', t.currency,
    'cuisine', t.cuisine_slug,
    'cuisines', to_jsonb(t.cuisines),
    'formats', to_jsonb(t.formats),
    'venue_type', t.venue_type,
    'venue', (select jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address, 'lat', v.latitude, 'lng', v.longitude)
                from public.venues v where v.id = t.venue_id),
    'area_label', t.area_label,
    'meet_lat', t.meet_lat,
    'meet_lng', t.meet_lng,
    'tags', to_jsonb(t.tags),
    'occasion', t.occasion,
    'community', t.community,
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
$function$;

-- ---------------------------------------------------------------- get_table: starting points never shown to strangers
create or replace function public.get_table(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $function$
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
  can_see := is_host or exists (select 1 from public.table_members x where x.table_id = p_id and x.user_id = me and x.status = 'joined');

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'role', m.role,
           'status', m.status,
           'display_name', p.display_name,
           'avatar_emoji', p.avatar_emoji,
           'no_show_count', case when is_host then p.no_show_count else null end,
           -- where someone starts from: only on friends tables (people who know each other), never for strangers
           'start_label', case when m.user_id = me or (t.is_private and can_see) then m.start_label end,
           'start_lat', case when m.user_id = me or (t.is_private and can_see) then m.start_lat end,
           'start_lng', case when m.user_id = me or (t.is_private and can_see) then m.start_lng end,
           'cuisine', case when is_host or m.user_id = me or (t.is_private and can_see) then m.cuisine_slug end,
           'diet_tags', case when is_host or m.user_id = me or (t.is_private and can_see) then to_jsonb(m.diet_tags) end,
           'diet_note', case when is_host or m.user_id = me or (t.is_private and can_see) then m.diet_note end
         ) order by m.joined_at nulls last, m.requested_at), '[]'::jsonb)
    into members
    from public.table_members m
    join public.profiles p on p.id = m.user_id
   where m.table_id = p_id
     and ((m.status = 'joined' and (not t.is_private or can_see)) or (is_host and m.status = 'requested') or m.user_id = me)
     and (m.user_id = me or not public.is_blocked_pair(me, m.user_id));

  select jsonb_build_object('start_label', m.start_label, 'start_lat', m.start_lat, 'start_lng', m.start_lng,
                            'intention', m.intention, 'pace', m.pace, 'cuisine', m.cuisine_slug,
                            'diet_tags', to_jsonb(m.diet_tags), 'diet_note', m.diet_note)
    into mine
    from public.table_members m where m.table_id = p_id and m.user_id = me;

  return public.table_json(t, me) || jsonb_build_object('members', members, 'my_membership', coalesce(mine, 'null'::jsonb),
                                                        'my_conduct', (select conduct_at is not null from public.profiles where id = me));
end $function$;
