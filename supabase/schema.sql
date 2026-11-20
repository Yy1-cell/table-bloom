-- =====================================================================
-- Table & Bloom — Supabase schema (PWA + future WeChat Mini Program)
--
-- How to use: Supabase dashboard -> SQL Editor -> New query -> paste this
-- whole file -> Run. It is safe to run again later (it drops and recreates
-- policies and functions, and never drops your data tables).
--
-- Design rules:
--  * Row Level Security (RLS) is ON for every table.
--  * The app never writes to table_members / dining_tables / reports directly.
--    All writes go through the functions below (SECURITY DEFINER), which
--    check capacity, blocks, rate limits and who is allowed to do what.
--  * Reflections are private: only their owner can ever read them.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Lookup tables
-- ---------------------------------------------------------------------
create table if not exists public.areas (
  id          uuid primary key default gen_random_uuid(),
  name_en     text not null,
  name_zh     text not null,
  center_lat  numeric not null,
  center_lng  numeric not null,
  timezone    text not null default 'America/Toronto',
  currency    text not null default 'CAD',
  is_active   boolean not null default true,
  sort        smallint not null default 0
);

create table if not exists public.cuisines (
  slug     text primary key,
  name_en  text not null,
  name_zh  text not null,
  emoji    text not null,
  grp      text not null default 'other',
  sort     smallint not null default 0
);

-- ---------------------------------------------------------------------
-- Profiles (one row per signed-in user; created automatically on sign-up)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  area_id          uuid references public.areas(id),
  display_name     text not null default 'New friend' check (char_length(display_name) between 1 and 30),
  avatar_emoji     text not null default '🍊' check (char_length(avatar_emoji) <= 8),
  language         text not null default 'en' check (language in ('en','zh')),
  languages_spoken text[] not null default '{}',
  dietary_notes    text check (char_length(dietary_notes) <= 200),
  budget_cents     integer check (budget_cents between 500 and 50000),
  no_show_count    smallint not null default 0,
  status           text not null default 'active' check (status in ('active','suspended')),
  wechat_openid    text unique,            -- filled later by the WeChat Mini Program login
  onboarded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.user_cuisine_prefs (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  cuisine_slug text not null references public.cuisines(slug) on delete cascade,
  rank         smallint not null check (rank between 1 and 50),
  primary key (user_id, cuisine_slug)
);

-- ---------------------------------------------------------------------
-- Venues, tables, members
-- ---------------------------------------------------------------------
create table if not exists public.venues (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 120),
  address      text check (char_length(address) <= 240),
  latitude     numeric,
  longitude    numeric,
  map_poi_id   text,
  cuisine_slug text references public.cuisines(slug),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.dining_tables (
  id                uuid primary key default gen_random_uuid(),
  host_id           uuid references public.profiles(id) on delete cascade,
  area_id           uuid references public.areas(id),
  title             text check (char_length(title) <= 60),
  audience          text not null default 'friends_and_new' check (audience in ('friends','friends_and_new','new_people')),
  starts_at         timestamptz not null,
  capacity          smallint not null check (capacity between 2 and 12),
  budget_cents      integer check (budget_cents between 0 and 50000),
  cuisine_slug      text references public.cuisines(slug),
  venue_id          uuid references public.venues(id) on delete set null,
  area_label        text check (char_length(area_label) <= 120),
  meet_lat          numeric,
  meet_lng          numeric,
  tags              text[] not null default '{}'
                    check (tags <@ array['mandarin_friendly','new_to_toronto','split_bill','bring_a_friend','easy_conversation','try_somewhere_new']),
  occasion          text check (occasion in ('date','family','friends','classmates','work','celebrate')),
  note              text check (char_length(note) <= 280),
  join_mode         text not null default 'request' check (join_mode in ('request','instant')),
  status            text not null default 'open' check (status in ('open','full','cancelled','completed')),
  -- demo/sample tables (no real host account); see seed_samples.sql
  is_sample         boolean not null default false,
  sample_host_name  text,
  sample_host_emoji text,
  sample_seats      smallint,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (host_id is not null or is_sample)
);
create index if not exists dining_tables_discover_idx on public.dining_tables (area_id, status, starts_at);
create index if not exists dining_tables_host_idx on public.dining_tables (host_id, created_at);

create table if not exists public.table_members (
  table_id     uuid not null references public.dining_tables(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'guest' check (role in ('host','guest')),
  status       text not null default 'requested' check (status in ('requested','joined','declined','left','removed')),
  start_label  text check (char_length(start_label) <= 120),
  start_lat    numeric,
  start_lng    numeric,
  intention    text check (intention in ('unwind','catch_up','study_tips','new_perspectives')),
  pace         text check (pace in ('talking','ease_in','listening')),
  requested_at timestamptz not null default now(),
  joined_at    timestamptz,
  primary key (table_id, user_id)
);
create index if not exists table_members_user_idx on public.table_members (user_id, status);
create index if not exists table_members_table_idx on public.table_members (table_id, status);

-- Friend tables: private (not listed in Discover, joined by invite link), and each member can say what they feel like eating.
alter table public.dining_tables add column if not exists is_private boolean not null default false;
alter table public.table_members add column if not exists cuisine_slug text references public.cuisines(slug);

-- ---------------------------------------------------------------------
-- Private reflections, blocks, reports
-- ---------------------------------------------------------------------
create table if not exists public.reflections (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  table_id             uuid references public.dining_tables(id) on delete set null,
  table_title          text check (char_length(table_title) <= 120),
  on_date              date not null default current_date,
  mood                 smallint check (mood between 1 and 5),
  food_enjoyment       smallint check (food_enjoyment between 1 and 5),
  conversation_comfort smallint check (conversation_comfort between 1 and 5),
  takeaway             text check (char_length(takeaway) <= 500),
  next_step            text check (char_length(next_step) <= 500),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists reflections_user_idx on public.reflections (user_id, on_date desc);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid references public.profiles(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  table_id         uuid references public.dining_tables(id) on delete set null,
  reason           text not null check (reason in ('harassment','no_show','unsafe','spam','other')),
  details          text check (char_length(details) <= 1000),
  status           text not null default 'new' check (status in ('new','reviewing','resolved')),
  resolved_by      text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  check (reported_user_id is not null or table_id is not null)
);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
-- 1) Create a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Users may edit their own profile, but never the trust fields.
create or replace function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if current_user in ('authenticated', 'anon') then
    new.id := old.id;
    new.status := old.status;
    new.no_show_count := old.no_show_count;
    new.wechat_openid := old.wechat_openid;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists reflections_touch on public.reflections;
create trigger reflections_touch before update on public.reflections
  for each row execute function public.touch_updated_at();

drop trigger if exists dining_tables_touch on public.dining_tables;
create trigger dining_tables_touch before update on public.dining_tables
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.areas              enable row level security;
alter table public.cuisines           enable row level security;
alter table public.profiles           enable row level security;
alter table public.user_cuisine_prefs enable row level security;
alter table public.venues             enable row level security;
alter table public.dining_tables      enable row level security;
alter table public.table_members      enable row level security;
alter table public.reflections        enable row level security;
alter table public.user_blocks        enable row level security;
alter table public.reports            enable row level security;

drop policy if exists areas_read on public.areas;
create policy areas_read on public.areas for select to authenticated using (is_active);

drop policy if exists cuisines_read on public.cuisines;
create policy cuisines_read on public.cuisines for select to authenticated using (true);

drop policy if exists profiles_own_select on public.profiles;
create policy profiles_own_select on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_own_update on public.profiles;
create policy profiles_own_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists prefs_own on public.user_cuisine_prefs;
create policy prefs_own on public.user_cuisine_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists reflections_own on public.reflections;
create policy reflections_own on public.reflections for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- dining_tables, table_members, venues, user_blocks, reports: no direct policies.
-- With RLS on and no policy, the API cannot read or write them directly;
-- everything goes through the SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_blocked_pair(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.require_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles where id = me and status = 'suspended') then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  return me;
end $$;

-- Re-evaluate open/full after anyone joins or leaves.
create or replace function public.refresh_table_status(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.dining_tables; taken int;
begin
  select * into t from public.dining_tables where id = p_table;
  if not found or t.status in ('cancelled', 'completed') or t.is_sample then return; end if;
  select count(*) into taken from public.table_members where table_id = p_table and status = 'joined';
  update public.dining_tables
     set status = case when taken >= t.capacity then 'full' else 'open' end
   where id = p_table;
end $$;

-- One table as JSON, shaped for the app.
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
    'occasion', t.occasion,
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

-- ---------------------------------------------------------------------
-- Reading tables
-- ---------------------------------------------------------------------
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

create or replace function public.list_my_tables() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select jsonb_agg(public.table_json(t, me) order by t.starts_at desc)
      from public.dining_tables t
     where t.starts_at > now() - interval '45 days'
       and exists (select 1 from public.table_members m
                    where m.table_id = t.id and m.user_id = me and m.status in ('requested', 'joined', 'declined'))
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Writing: create / join / leave / approve / cancel
-- ---------------------------------------------------------------------
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
                                    venue_id, area_label, meet_lat, meet_lng, tags, occasion, note, join_mode, is_private)
  values (me, nullif(p->>'area_id', '')::uuid, v_title, coalesce(p->>'audience', 'friends_and_new'), v_starts, v_cap,
          nullif(p->>'budget_cents', '')::int, nullif(p->>'cuisine', ''), v_venue, left(p->>'area_label', 120),
          nullif(p->>'meet_lat', '')::numeric, nullif(p->>'meet_lng', '')::numeric, v_tags, nullif(p->>'occasion', ''), v_note,
          case when v_private then 'instant' else coalesce(p->>'join_mode', 'request') end, v_private)
  returning id into v_id;

  insert into public.table_members (table_id, user_id, role, status, joined_at, intention, pace)
  values (v_id, me, 'host', 'joined', now(), nullif(p->>'intention', ''), nullif(p->>'pace', ''));

  perform public.refresh_table_status(v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.request_join(
  p_table uuid, p_start_label text default null, p_start_lat numeric default null,
  p_start_lng numeric default null, p_intention text default null, p_pace text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  t public.dining_tables;
  ex public.table_members;
  new_status text;
  taken int;
begin
  select * into t from public.dining_tables where id = p_table for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.is_sample then raise exception 'sample_table' using errcode = '22023'; end if;
  if t.host_id = me then raise exception 'is_host' using errcode = '22023'; end if;
  if public.is_blocked_pair(me, t.host_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status <> 'open' then raise exception 'not_open' using errcode = '22023'; end if;
  if t.starts_at < now() then raise exception 'start_in_past' using errcode = '22023'; end if;

  select * into ex from public.table_members where table_id = p_table and user_id = me;
  if found and ex.status in ('requested', 'joined') then raise exception 'already_member' using errcode = '23505'; end if;
  if found and ex.status in ('declined', 'removed') then raise exception 'not_allowed' using errcode = '42501'; end if;

  if (select count(*) from public.table_members where user_id = me and status = 'requested') >= 5 then
    raise exception 'too_many_requests' using errcode = '54000';
  end if;

  new_status := case when t.join_mode = 'instant' then 'joined' else 'requested' end;
  if new_status = 'joined' then
    select count(*) into taken from public.table_members where table_id = p_table and status = 'joined';
    if taken >= t.capacity then raise exception 'full' using errcode = '22023'; end if;
  end if;

  insert into public.table_members (table_id, user_id, role, status, start_label, start_lat, start_lng, intention, pace, requested_at, joined_at)
  values (p_table, me, 'guest', new_status, left(p_start_label, 120), p_start_lat, p_start_lng,
          nullif(p_intention, ''), nullif(p_pace, ''), now(), case when new_status = 'joined' then now() end)
  on conflict (table_id, user_id) do update
     set status = excluded.status, start_label = excluded.start_label, start_lat = excluded.start_lat,
         start_lng = excluded.start_lng, intention = excluded.intention, pace = excluded.pace,
         requested_at = now(), joined_at = excluded.joined_at;

  perform public.refresh_table_status(p_table);
  return jsonb_build_object('status', new_status);
end $$;

create or replace function public.update_membership(
  p_table uuid, p_start_label text default null, p_start_lat numeric default null,
  p_start_lng numeric default null, p_intention text default null, p_pace text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  update public.table_members
     set start_label = left(p_start_label, 120), start_lat = p_start_lat, start_lng = p_start_lng,
         intention = nullif(p_intention, ''), pace = nullif(p_pace, '')
   where table_id = p_table and user_id = me and status in ('requested', 'joined');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.set_my_craving(p_table uuid, p_cuisine text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  update public.table_members set cuisine_slug = nullif(p_cuisine, '')
   where table_id = p_table and user_id = me and status in ('requested', 'joined');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.leave_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); t public.dining_tables;
begin
  select * into t from public.dining_tables where id = p_table for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.host_id = me then raise exception 'host_cannot_leave' using errcode = '22023'; end if;
  update public.table_members set status = 'left'
   where table_id = p_table and user_id = me and status in ('requested', 'joined');
  perform public.refresh_table_status(p_table);
end $$;

create or replace function public.respond_join(p_table uuid, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); t public.dining_tables; taken int;
begin
  select * into t from public.dining_tables where id = p_table for update;
  if not found or t.host_id is distinct from me then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.table_members where table_id = p_table and user_id = p_user and status = 'requested') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_accept then
    select count(*) into taken from public.table_members where table_id = p_table and status = 'joined';
    if taken >= t.capacity then raise exception 'full' using errcode = '22023'; end if;
    update public.table_members set status = 'joined', joined_at = now() where table_id = p_table and user_id = p_user;
  else
    update public.table_members set status = 'declined' where table_id = p_table and user_id = p_user;
  end if;
  perform public.refresh_table_status(p_table);
end $$;

create or replace function public.remove_member(p_table uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.dining_tables where id = p_table and host_id = me) or p_user = me then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.table_members set status = 'removed'
   where table_id = p_table and user_id = p_user and status in ('requested', 'joined');
  perform public.refresh_table_status(p_table);
end $$;

create or replace function public.cancel_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  update public.dining_tables set status = 'cancelled' where id = p_table and host_id = me and status in ('open', 'full');
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
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

-- The host confirms that someone did not show up after the table started.
create or replace function public.mark_no_show(p_table uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); t public.dining_tables;
begin
  select * into t from public.dining_tables where id = p_table;
  if not found or t.host_id is distinct from me or t.starts_at > now() or p_user = me then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.table_members set status = 'left'
   where table_id = p_table and user_id = p_user and status = 'joined';
  if found then
    update public.profiles set no_show_count = least(no_show_count + 1, 100) where id = p_user;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Safety: report / block / unblock
-- ---------------------------------------------------------------------
create or replace function public.report_content(p_table uuid, p_user uuid, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if p_table is null and p_user is null then raise exception 'bad_report' using errcode = '22023'; end if;
  if (select count(*) from public.reports where reporter_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.reports (reporter_id, reported_user_id, table_id, reason, details)
  values (me, p_user, p_table, p_reason, left(p_details, 1000));
end $$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if p_user is null or p_user = me then raise exception 'bad_request' using errcode = '22023'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (me, p_user) on conflict do nothing;
  -- Leave any table the blocked person hosts; drop their pending requests to mine.
  update public.table_members m set status = 'left'
   where m.user_id = me and m.status in ('requested', 'joined')
     and exists (select 1 from public.dining_tables t where t.id = m.table_id and t.host_id = p_user);
  update public.table_members m set status = 'removed'
   where m.user_id = p_user and m.status in ('requested', 'joined')
     and exists (select 1 from public.dining_tables t where t.id = m.table_id and t.host_id = me);
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  delete from public.user_blocks where blocker_id = me and blocked_id = p_user;
end $$;

create or replace function public.list_blocks() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', b.blocked_id, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji)
                     order by b.created_at desc)
      from public.user_blocks b join public.profiles p on p.id = b.blocked_id
     where b.blocker_id = me
  ), '[]'::jsonb);
end $$;

-- Permanently deletes the signed-in user's account and everything they own.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from auth.users where id = me;
end $$;

-- ---------------------------------------------------------------------
-- Function permissions: only signed-in users may call the app functions.
-- ---------------------------------------------------------------------
revoke all on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.require_user() from public, anon, authenticated;
revoke all on function public.refresh_table_status(uuid) from public, anon, authenticated;
revoke all on function public.table_json(public.dining_tables, uuid) from public, anon, authenticated;

revoke all on function public.list_tables(uuid) from public, anon;
revoke all on function public.get_table(uuid) from public, anon;
revoke all on function public.list_my_tables() from public, anon;
revoke all on function public.create_table(jsonb) from public, anon;
revoke all on function public.request_join(uuid, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.update_membership(uuid, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.leave_table(uuid) from public, anon;
revoke all on function public.respond_join(uuid, uuid, boolean) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.cancel_table(uuid) from public, anon;
revoke all on function public.set_venue(uuid, jsonb) from public, anon;
revoke all on function public.set_my_craving(uuid, text) from public, anon;
revoke all on function public.mark_no_show(uuid, uuid) from public, anon;
revoke all on function public.report_content(uuid, uuid, text, text) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.list_blocks() from public, anon;
revoke all on function public.delete_my_account() from public, anon;

grant execute on function public.list_tables(uuid) to authenticated;
grant execute on function public.get_table(uuid) to authenticated;
grant execute on function public.list_my_tables() to authenticated;
grant execute on function public.create_table(jsonb) to authenticated;
grant execute on function public.request_join(uuid, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.update_membership(uuid, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.leave_table(uuid) to authenticated;
grant execute on function public.respond_join(uuid, uuid, boolean) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.cancel_table(uuid) to authenticated;
grant execute on function public.set_venue(uuid, jsonb) to authenticated;
grant execute on function public.set_my_craving(uuid, text) to authenticated;
grant execute on function public.mark_no_show(uuid, uuid) to authenticated;
grant execute on function public.report_content(uuid, uuid, text, text) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_blocks() to authenticated;
grant execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------------------
-- Photo album: pictures shared by the people at a table (members only)
-- Files live in the private Storage bucket "table-photos" under <table_id>/<user_id>/<file>.jpg
-- ---------------------------------------------------------------------
create table if not exists public.table_photos (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.dining_tables(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  path       text not null unique check (char_length(path) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists table_photos_table_idx on public.table_photos (table_id, created_at);
alter table public.table_photos enable row level security;   -- no policies: only the functions below touch it

create or replace function public.is_table_member(p_table uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.table_members m
                  where m.table_id = p_table and m.user_id = p_user and m.status = 'joined');
$$;

create or replace function public.add_table_photo(p_table uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); v_id uuid;
begin
  if not public.is_table_member(p_table, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_path is null or left(p_path, 74) <> (p_table::text || '/' || me::text || '/') then
    raise exception 'bad_request' using errcode = '22023';
  end if;
  if (select count(*) from public.table_photos where table_id = p_table) >= 12 then
    raise exception 'too_many_photos' using errcode = '54000';
  end if;
  insert into public.table_photos (table_id, user_id, path) values (p_table, me, p_path) returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.list_table_photos(p_table uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not public.is_table_member(p_table, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ph.id, 'user_id', ph.user_id, 'path', ph.path, 'created_at', ph.created_at,
                                        'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji) order by ph.created_at)
      from public.table_photos ph join public.profiles p on p.id = ph.user_id
     where ph.table_id = p_table
       and (ph.user_id = me or not public.is_blocked_pair(me, ph.user_id))
  ), '[]'::jsonb);
end $$;

-- Returns the storage path that was removed so the app can delete the file too.
create or replace function public.delete_table_photo(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); v_path text;
begin
  delete from public.table_photos where id = p_id and user_id = me returning path into v_path;
  return v_path;
end $$;

revoke all on function public.is_table_member(uuid, uuid) from public, anon;
revoke all on function public.add_table_photo(uuid, text) from public, anon;
revoke all on function public.list_table_photos(uuid) from public, anon;
revoke all on function public.delete_table_photo(uuid) from public, anon;
grant execute on function public.is_table_member(uuid, uuid) to authenticated;   -- used by the Storage policies below
grant execute on function public.add_table_photo(uuid, text) to authenticated;
grant execute on function public.list_table_photos(uuid) to authenticated;
grant execute on function public.delete_table_photo(uuid) to authenticated;

-- Storage bucket + policies (only on Supabase, where the "storage" schema exists)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('table-photos', 'table-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

    drop policy if exists "tb photos read" on storage.objects;
    create policy "tb photos read" on storage.objects for select to authenticated
      using (bucket_id = 'table-photos' and public.is_table_member(((storage.foldername(name))[1])::uuid, auth.uid()));

    drop policy if exists "tb photos upload" on storage.objects;
    create policy "tb photos upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'table-photos' and (storage.foldername(name))[2] = auth.uid()::text
                  and public.is_table_member(((storage.foldername(name))[1])::uuid, auth.uid()));

    drop policy if exists "tb photos delete" on storage.objects;
    create policy "tb photos delete" on storage.objects for delete to authenticated
      using (bucket_id = 'table-photos' and (storage.foldername(name))[2] = auth.uid()::text);
  end if;
end $$;

-- ---------------------------------------------------------------------

-- Trigger-only functions must not be callable through the REST API.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.profiles_guard() from anon, authenticated, public;
revoke execute on function public.touch_updated_at() from anon, authenticated, public;
alter function public.profiles_guard() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- Starter data (safe to re-run)
-- ---------------------------------------------------------------------
alter table public.cuisines add column if not exists grp text not null default 'other';

insert into public.cuisines (slug, name_en, name_zh, emoji, grp, sort) values
  ('hotpot', 'Hot pot', '火锅', '🥘', 'chinese', 1),
  ('sichuan', 'Sichuan', '川菜', '🌶️', 'chinese', 2),
  ('cantonese', 'Cantonese & roast meats', '粤菜·烧腊', '🦆', 'chinese', 3),
  ('dimsum', 'Dim sum', '早茶点心', '🥟', 'chinese', 4),
  ('noodles', 'Noodles & dumplings', '面食饺子', '🍜', 'chinese', 5),
  ('skewers', 'BBQ & skewers', '烧烤串串', '🍢', 'chinese', 6),
  ('hk_cafe', 'HK café', '港式茶餐厅', '🍍', 'chinese', 7),
  ('taiwanese', 'Taiwanese', '台湾菜', '🍚', 'chinese', 8),
  ('regional', 'Other regional Chinese', '湘菜·东北·江浙', '🥢', 'chinese', 9),
  ('japanese', 'Japanese & sushi', '日料·寿司', '🍣', 'japan_korea', 10),
  ('ramen', 'Ramen & udon', '拉面乌冬', '🍥', 'japan_korea', 11),
  ('izakaya', 'Izakaya', '居酒屋', '🏮', 'japan_korea', 12),
  ('korean_bbq', 'Korean BBQ', '韩式烤肉', '🍖', 'japan_korea', 13),
  ('korean', 'Korean', '韩餐·炖锅', '🍲', 'japan_korea', 14),
  ('thai', 'Thai', '泰餐', '🥥', 'asia', 15),
  ('vietnamese', 'Vietnamese', '越南菜', '🥖', 'asia', 16),
  ('indian', 'Indian', '印度菜', '🍛', 'asia', 17),
  ('american', 'American & burgers', '美式·汉堡', '🍔', 'western', 18),
  ('steak', 'Steak & grill', '牛排·扒房', '🥩', 'western', 19),
  ('italian', 'Italian & pasta', '意餐·意面', '🍝', 'western', 20),
  ('pizza', 'Pizza', '披萨', '🍕', 'western', 21),
  ('mexican', 'Mexican', '墨西哥菜', '🌮', 'western', 22),
  ('mediterranean', 'Mediterranean & Middle Eastern', '中东·地中海', '🥙', 'western', 23),
  ('seafood', 'Seafood', '海鲜', '🦞', 'western', 24),
  ('brunch', 'Brunch', '早午餐', '🥞', 'western', 25),
  ('fried_chicken', 'Fried chicken & wings', '炸鸡·鸡翅', '🍗', 'casual', 26),
  ('pub', 'Pub & bar food', '酒馆 Pub', '🍻', 'casual', 27),
  ('buffet', 'Buffet', '自助餐', '🍱', 'casual', 28),
  ('vegetarian', 'Vegetarian & vegan', '素食·轻食', '🥗', 'casual', 29),
  ('cafe', 'Café & light bites', '咖啡轻食', '☕', 'sweet', 30),
  ('bubble_tea', 'Bubble tea', '奶茶', '🧋', 'sweet', 31),
  ('dessert', 'Dessert & bakery', '甜品·烘焙', '🍰', 'sweet', 32),
  ('latin', 'Latin American & South American', '拉美·南美菜', '🦙', 'western', 33)
on conflict (slug) do update set name_en = excluded.name_en, name_zh = excluded.name_zh, emoji = excluded.emoji, grp = excluded.grp, sort = excluded.sort;

insert into public.areas (id, name_en, name_zh, center_lat, center_lng, sort)
select * from (values
  ('6f1a0001-0000-4000-8000-000000000001'::uuid, 'Toronto — Downtown',          '多伦多市中心',        43.6596::numeric, -79.3970::numeric, 1::smallint),
  ('6f1a0001-0000-4000-8000-000000000002'::uuid, 'Toronto — North York',        'North York',          43.7615::numeric, -79.4111::numeric, 2::smallint),
  ('6f1a0001-0000-4000-8000-000000000003'::uuid, 'Toronto — Scarborough',       'Scarborough',         43.7731::numeric, -79.2578::numeric, 3::smallint),
  ('6f1a0001-0000-4000-8000-000000000004'::uuid, 'Mississauga',                 'Mississauga',         43.5890::numeric, -79.6441::numeric, 4::smallint),
  ('6f1a0001-0000-4000-8000-000000000005'::uuid, 'Markham & Richmond Hill',     'Markham／Richmond Hill', 43.8561::numeric, -79.3370::numeric, 5::smallint)
) as v(id, name_en, name_zh, center_lat, center_lng, sort)
on conflict (id) do update set name_en = excluded.name_en, name_zh = excluded.name_zh,
  center_lat = excluded.center_lat, center_lng = excluded.center_lng, sort = excluded.sort;

-- ---------------------------------------------------------------------
-- Post-meal check-in (see supabase/migrations/2026-11-14_table_feelings.sql)
-- ---------------------------------------------------------------------
create table if not exists public.table_feelings (
  table_id    uuid not null references public.dining_tables(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  overall     smallint not null check (overall between 1 and 5),
  mood_before smallint check (mood_before between 1 and 5),
  mood_after  smallint check (mood_after between 1 and 5),
  vibes       text[] not null default '{}'
              check (vibes <@ array['relaxed','easy_talk','funny','deep','warm','new_friends','awkward','tiring','rushed']
                     and cardinality(vibes) <= 5),
  note        text check (char_length(note) <= 300),
  shared      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (table_id, user_id)
);
create index if not exists table_feelings_user_idx on public.table_feelings (user_id, created_at desc);

create table if not exists public.peer_signals (
  table_id  uuid not null references public.dining_tables(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user   uuid not null references public.profiles(id) on delete cascade,
  signal    text not null check (signal in ('again','neutral','pass')),
  created_at timestamptz not null default now(),
  primary key (table_id, from_user, to_user),
  check (from_user <> to_user)
);
alter table public.table_feelings enable row level security;   -- no policies: only the functions below touch it
alter table public.peer_signals   enable row level security;

drop trigger if exists table_feelings_touch on public.table_feelings;
create trigger table_feelings_touch before update on public.table_feelings
  for each row execute function public.touch_updated_at();

-- Save (insert or replace) my check-in for a table that has started. p = {table_id, overall, mood_before?, mood_after?,
-- vibes?, note?, shared?, peers?: [{user_id, signal}]}
create or replace function public.save_feeling(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  tid uuid := nullif(p->>'table_id', '')::uuid;
  t public.dining_tables;
  v_vibes text[];
  peer jsonb;
begin
  if tid is null then raise exception 'bad_request' using errcode = '22023'; end if;
  if not public.is_table_member(tid, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.dining_tables where id = tid;
  if t.is_sample then raise exception 'sample_table' using errcode = '42501'; end if;
  if t.starts_at > now() then raise exception 'too_early' using errcode = '22023'; end if;
  if coalesce((p->>'overall')::int, 0) not between 1 and 5 then raise exception 'bad_request' using errcode = '22023'; end if;
  select coalesce(array_agg(x), '{}') into v_vibes from jsonb_array_elements_text(coalesce(p->'vibes', '[]'::jsonb)) x;

  insert into public.table_feelings (table_id, user_id, overall, mood_before, mood_after, vibes, note, shared)
  values (tid, me, (p->>'overall')::int, nullif(p->>'mood_before', '')::int, nullif(p->>'mood_after', '')::int,
          v_vibes, nullif(left(coalesce(p->>'note', ''), 300), ''), coalesce((p->>'shared')::boolean, true))
  on conflict (table_id, user_id) do update
    set overall = excluded.overall, mood_before = excluded.mood_before, mood_after = excluded.mood_after,
        vibes = excluded.vibes, note = excluded.note, shared = excluded.shared;

  -- private "would eat with again" signals (only for people who were at this table)
  for peer in select * from jsonb_array_elements(coalesce(p->'peers', '[]'::jsonb)) loop
    if (peer->>'user_id')::uuid <> me and public.is_table_member(tid, (peer->>'user_id')::uuid) then
      if peer->>'signal' in ('again','neutral','pass') then
        insert into public.peer_signals (table_id, from_user, to_user, signal)
        values (tid, me, (peer->>'user_id')::uuid, peer->>'signal')
        on conflict (table_id, from_user, to_user) do update set signal = excluded.signal;
      else
        delete from public.peer_signals where table_id = tid and from_user = me and to_user = (peer->>'user_id')::uuid;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- What I wrote + (only after I have submitted) what the others at the table chose to share.
create or replace function public.get_feelings(p_table uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user(); mine jsonb;
begin
  if not public.is_table_member(p_table, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select to_jsonb(f) - 'table_id' - 'user_id' into mine from public.table_feelings f where f.table_id = p_table and f.user_id = me;
  return jsonb_build_object(
    'mine', mine,
    'peers', coalesce((select jsonb_object_agg(s.to_user::text, s.signal) from public.peer_signals s
                        where s.table_id = p_table and s.from_user = me), '{}'::jsonb),
    'waiting', (select count(*) from public.table_members m
                 where m.table_id = p_table and m.status = 'joined' and m.user_id <> me
                   and not exists (select 1 from public.table_feelings f where f.table_id = p_table and f.user_id = m.user_id)),
    'others', case when mine is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', f.user_id, 'display_name', pr.display_name, 'avatar_emoji', pr.avatar_emoji,
               'overall', f.overall,
               'vibes', (select coalesce(jsonb_agg(v), '[]'::jsonb) from unnest(f.vibes) v
                          where v in ('relaxed','easy_talk','funny','deep','warm','new_friends'))
             ) order by f.created_at)
        from public.table_feelings f join public.profiles pr on pr.id = f.user_id
       where f.table_id = p_table and f.user_id <> me and f.shared
         and public.is_table_member(p_table, f.user_id)
         and not public.is_blocked_pair(me, f.user_id)
    ), '[]'::jsonb) end
  );
end $$;

-- Everything I have checked in, with the table facts needed to build my dining profile.
create or replace function public.list_my_feelings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'table_id', f.table_id, 'overall', f.overall, 'mood_before', f.mood_before, 'mood_after', f.mood_after,
             'vibes', to_jsonb(f.vibes), 'created_at', f.created_at,
             'cuisine', t.cuisine_slug, 'occasion', t.occasion, 'starts_at', t.starts_at,
             'seats', (select count(*) from public.table_members m where m.table_id = t.id and m.status = 'joined'),
             'title', t.title
           ) order by t.starts_at desc)
      from public.table_feelings f join public.dining_tables t on t.id = f.table_id
     where f.user_id = me
  ), '[]'::jsonb);
end $$;

revoke all on function public.save_feeling(jsonb) from public, anon;
revoke all on function public.get_feelings(uuid) from public, anon;
revoke all on function public.list_my_feelings() from public, anon;
grant execute on function public.save_feeling(jsonb) to authenticated;
grant execute on function public.get_feelings(uuid) to authenticated;
grant execute on function public.list_my_feelings() to authenticated;

-- ---------------------------------------------------------------------
-- Operator console (see supabase/migrations/2026-11-14_admin.sql and 2026-11-14_again_people.sql)
-- ---------------------------------------------------------------------
create table if not exists public.app_admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;   -- no policies: only the functions below read it
insert into public.app_admins (email) values ('zhixunyan1@gmail.com') on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.app_admins a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create or replace function public.admin_check() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_admin(); $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'users',      (select count(*) from auth.users),
    'guests',     (select count(*) from auth.users where is_anonymous),
    'suspended',  (select count(*) from public.profiles where status = 'suspended'),
    'tables_open',      (select count(*) from public.dining_tables where not is_sample and status in ('open','full') and starts_at >= now() - interval '2 hours'),
    'tables_past',      (select count(*) from public.dining_tables where not is_sample and (status = 'completed' or (status in ('open','full') and starts_at < now() - interval '2 hours'))),
    'tables_cancelled', (select count(*) from public.dining_tables where not is_sample and status = 'cancelled'),
    'reports_new',      (select count(*) from public.reports where status = 'new')
  );
end $$;

create or replace function public.admin_list_users(p_limit int default 500) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(q.x order by q.x->>'created_at' desc)
    from (
      select jsonb_build_object(
        'id', u.id, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji,
        'is_anonymous', u.is_anonymous,
        'email', case when u.email is null or u.email = '' then null else left(u.email, 1) || '***' || substr(u.email, position('@' in u.email)) end,
        'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'status', coalesce(p.status, 'active'),
        'is_admin', exists (select 1 from public.app_admins a where a.email = lower(coalesce(u.email, ''))),
        'onboarded', p.onboarded_at is not null,
        'hosted', (select count(*) from public.dining_tables t where t.host_id = u.id),
        'joined', (select count(*) from public.table_members m where m.user_id = u.id and m.role = 'guest' and m.status = 'joined')
      ) as x
      from auth.users u left join public.profiles p on p.id = u.id
      order by u.created_at desc limit least(greatest(p_limit, 1), 1000)
    ) q
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_list_tables(p_limit int default 500) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(q.x order by q.x->>'starts_at' desc)
    from (
      select jsonb_build_object(
        'id', t.id, 'title', t.title, 'cuisine', t.cuisine_slug, 'occasion', t.occasion, 'starts_at', t.starts_at,
        'status', t.status, 'is_private', t.is_private, 'is_sample', t.is_sample,
        'host_id', t.host_id, 'host_name', coalesce(h.display_name, t.sample_host_name),
        'host_is_guest', coalesce((select u.is_anonymous from auth.users u where u.id = t.host_id), false),
        'members', (select count(*) from public.table_members m where m.table_id = t.id and m.status = 'joined'),
        'created_at', t.created_at
      ) as x
      from public.dining_tables t left join public.profiles h on h.id = t.host_id
      order by t.starts_at desc limit least(greatest(p_limit, 1), 1000)
    ) q
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_list_reports() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at,
      'reporter_id', r.reporter_id, 'reporter_name', rp.display_name,
      'reported_id', r.reported_user_id, 'reported_name', dp.display_name, 'reported_status', dp.status,
      'table_id', r.table_id, 'table_title', t.title
    ) order by r.created_at desc)
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles dp on dp.id = r.reported_user_id
    left join public.dining_tables t on t.id = r.table_id
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := public.require_admin();
begin
  if p_status not in ('active', 'suspended') then raise exception 'bad_request' using errcode = '22023'; end if;
  if p_user = me then raise exception 'not_allowed' using errcode = '42501'; end if;
  if exists (select 1 from auth.users u join public.app_admins a on a.email = lower(coalesce(u.email, '')) where u.id = p_user) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.profiles set status = p_status where id = p_user;
end $$;

create or replace function public.admin_cancel_tables(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_admin();
  if coalesce(cardinality(p_ids), 0) > 200 then raise exception 'bad_request' using errcode = '22023'; end if;
  update public.dining_tables set status = 'cancelled' where id = any(p_ids) and not is_sample and status in ('open', 'full');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_resolve_report(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_status not in ('new', 'reviewing', 'resolved') then raise exception 'bad_request' using errcode = '22023'; end if;
  update public.reports set status = p_status, resolved_by = case when p_status = 'resolved' then 'admin' else null end,
         resolved_at = case when p_status = 'resolved' then now() else null end where id = p_id;
end $$;

-- Permanently deletes accounts (and, by cascade, their profile, tables they host, memberships, check-ins).
-- Never deletes the caller or any admin account. Returns how many were deleted.
create or replace function public.admin_purge_users(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := public.require_admin(); n int;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then return 0; end if;
  if cardinality(p_ids) > 200 then raise exception 'bad_request' using errcode = '22023'; end if;
  delete from auth.users u
   where u.id = any(p_ids) and u.id <> me
     and not exists (select 1 from public.app_admins a where a.email = lower(coalesce(u.email, '')));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.admin_check() from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_list_users(int) from public, anon;
revoke all on function public.admin_list_tables(int) from public, anon;
revoke all on function public.admin_list_reports() from public, anon;
revoke all on function public.admin_set_user_status(uuid, text) from public, anon;
revoke all on function public.admin_cancel_tables(uuid[]) from public, anon;
revoke all on function public.admin_resolve_report(uuid, text) from public, anon;
revoke all on function public.admin_purge_users(uuid[]) from public, anon;
grant execute on function public.admin_check() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_users(int) to authenticated;
grant execute on function public.admin_list_tables(int) to authenticated;
grant execute on function public.admin_list_reports() to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.admin_cancel_tables(uuid[]) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;
grant execute on function public.admin_purge_users(uuid[]) to authenticated;

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

-- ---------------------------------------------------------------------
-- Two-level food menu: cuisine groups, formats, venue type (2026-11-15_menu_two_level.sql)
-- ---------------------------------------------------------------------
-- New food menu: cuisine in two levels (Chinese regions, Southeast/South Asia, Western) + "how we eat" formats
-- (multi-select) + venue type (single). Existing tables, cravings, venues and rankings are moved to the new slugs.
-- Safe to re-run.

-- 1. New columns on tables ---------------------------------------------------------------------
alter table public.dining_tables add column if not exists formats text[] not null default '{}';
alter table public.dining_tables add column if not exists venue_type text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dining_tables_formats_check') then
    alter table public.dining_tables add constraint dining_tables_formats_check
      check (formats <@ array['hotpot','bbq','dimsum','noodles','seafood','buffet','brunch','veg']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dining_tables_venue_type_check') then
    alter table public.dining_tables add constraint dining_tables_venue_type_check
      check (venue_type is null or venue_type in ('fast','casual','dine','cafe','bar'));
  end if;
end $$;

-- A craving can be a cuisine or one of the formats, so it no longer points at the cuisines table.
alter table public.table_members drop constraint if exists table_members_cuisine_slug_fkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'table_members_cuisine_slug_check') then
    alter table public.table_members add constraint table_members_cuisine_slug_check
      check (cuisine_slug is null or cuisine_slug ~ '^[a-z_]{1,30}$');
  end if;
end $$;

-- 2. The new cuisine menu ------------------------------------------------------------------------
insert into public.cuisines (slug, name_en, name_zh, emoji, grp, sort) values
  ('chinese',       'Chinese',                         '中餐',          '🥢', 'chinese',  1),
  ('sichuan',       'Sichuan',                         '川菜',          '🌶️', 'chinese',  2),
  ('hunan',         'Hunan',                           '湘菜',          '🌶️', 'chinese',  3),
  ('cantonese',     'Cantonese & Hong Kong',           '粤菜·港式',     '🦆', 'chinese',  4),
  ('dongbei',       'Northeastern',                    '东北菜',        '🥟', 'chinese',  5),
  ('jiangzhe',      'Jiangsu, Zhejiang & Shanghai',    '江浙沪菜',      '🦀', 'chinese',  6),
  ('xibei',         'Northwestern & Xinjiang',         '西北·新疆菜',   '🍢', 'chinese',  7),
  ('yungui',        'Yunnan & Guizhou',                '云贵菜',        '🍄', 'chinese',  8),
  ('taiwanese',     'Taiwanese',                       '台湾菜',        '🍚', 'chinese',  9),
  ('japanese',      'Japanese',                        '日料',          '🍣', 'japanese', 10),
  ('korean',        'Korean',                          '韩餐',          '🍲', 'korean',   11),
  ('asia',          'Southeast & South Asian',         '东南亚·南亚',   '🥥', 'asia',     12),
  ('thai',          'Thai',                            '泰餐',          '🥥', 'asia',     13),
  ('vietnamese',    'Vietnamese',                      '越南菜',        '🥖', 'asia',     14),
  ('indian',        'Indian',                          '印度菜',        '🍛', 'asia',     15),
  ('western',       'Western',                         '西餐',          '🍽️', 'western',  16),
  ('american',      'American',                        '美式',          '🍔', 'western',  17),
  ('italian',       'Italian',                         '意餐',          '🍝', 'western',  18),
  ('french',        'French & European',               '法餐·欧陆',     '🥐', 'western',  19),
  ('mexican',       'Mexican & Latin American',        '墨西哥·拉美',   '🌮', 'latin',    20),
  ('mediterranean', 'Mediterranean & Middle Eastern',  '中东·地中海',   '🥙', 'mideast',  21)
on conflict (slug) do update set name_en = excluded.name_en, name_zh = excluded.name_zh, emoji = excluded.emoji,
                                 grp = excluded.grp, sort = excluded.sort;

-- 3. Move everything saved under the old slugs ------------------------------------------------------
drop table if exists _cmap;
create temp table _cmap (old text primary key, new text, fmts text[], vt text);
insert into _cmap values
  ('hotpot', 'chinese', '{hotpot}', null),       ('sichuan', 'sichuan', '{}', null),
  ('cantonese', 'cantonese', '{}', null),         ('dimsum', 'cantonese', '{dimsum}', null),
  ('noodles', 'chinese', '{noodles}', null),      ('skewers', 'chinese', '{bbq}', null),
  ('hk_cafe', 'cantonese', '{}', 'casual'),       ('taiwanese', 'taiwanese', '{}', null),
  ('regional', 'chinese', '{}', null),            ('japanese', 'japanese', '{}', null),
  ('ramen', 'japanese', '{noodles}', null),       ('izakaya', 'japanese', '{}', 'bar'),
  ('korean_bbq', 'korean', '{bbq}', null),        ('korean', 'korean', '{}', null),
  ('thai', 'thai', '{}', null),                   ('vietnamese', 'vietnamese', '{}', null),
  ('indian', 'indian', '{}', null),               ('american', 'american', '{}', null),
  ('steak', 'american', '{bbq}', 'dine'),         ('italian', 'italian', '{}', null),
  ('pizza', 'italian', '{}', 'casual'),           ('mexican', 'mexican', '{}', null),
  ('latin', 'mexican', '{}', null),               ('mediterranean', 'mediterranean', '{}', null),
  ('seafood', null, '{seafood}', null),           ('brunch', null, '{brunch}', null),
  ('fried_chicken', 'american', '{}', 'fast'),    ('pub', null, '{}', 'bar'),
  ('buffet', null, '{buffet}', null),             ('vegetarian', null, '{veg}', null),
  ('cafe', null, '{}', 'cafe'),                   ('bubble_tea', null, '{}', 'cafe'),
  ('dessert', null, '{}', 'cafe');

update public.dining_tables t
   set cuisine_slug = m.new,
       formats = (select coalesce(array_agg(distinct f), '{}') from unnest(t.formats || m.fmts) f),
       venue_type = coalesce(t.venue_type, m.vt)
  from _cmap m where t.cuisine_slug = m.old;
update public.venues v set cuisine_slug = m.new from _cmap m where v.cuisine_slug = m.old;
update public.table_members x set cuisine_slug = m.new from _cmap m where x.cuisine_slug = m.old;

-- Rankings: merge slugs that now point to the same thing and keep the better rank.
drop table if exists _prefs;
create temp table _prefs as
  select p.user_id, m.new as slug, min(p.rank) as rank
    from public.user_cuisine_prefs p join _cmap m on m.old = p.cuisine_slug
   where m.new is not null
   group by 1, 2;
delete from public.user_cuisine_prefs where cuisine_slug in (select old from _cmap);
insert into public.user_cuisine_prefs (user_id, cuisine_slug, rank)
  select user_id, slug, row_number() over (partition by user_id order by rank, slug) from _prefs
  on conflict do nothing;

drop table if exists _prefs;

-- Retired slugs go away (nothing points at them any more).
delete from public.cuisines
 where slug not in ('chinese','sichuan','hunan','cantonese','dongbei','jiangzhe','xibei','yungui','taiwanese','japanese',
                    'korean','asia','thai','vietnamese','indian','western','american','italian','french','mexican','mediterranean');

drop table if exists _cmap;

-- 4. Functions that read or write the new fields ------------------------------------------------------------
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
    'formats', to_jsonb(t.formats),
    'venue_type', t.venue_type,
    'venue', (select jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address, 'lat', v.latitude, 'lng', v.longitude)
                from public.venues v where v.id = t.venue_id),
    'area_label', t.area_label,
    'meet_lat', t.meet_lat,
    'meet_lng', t.meet_lng,
    'tags', to_jsonb(t.tags),
    'occasion', t.occasion,
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

create or replace function public.create_table(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  v_starts timestamptz := (p->>'starts_at')::timestamptz;
  v_cap int := (p->>'capacity')::int;
  v_venue uuid := null;
  v_id uuid;
  v_tags text[];
  v_formats text[];
  v_vtype text := nullif(p->>'venue_type', '');
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
  -- up to three formats, only the known ones
  select coalesce(array_agg(f), '{}') into v_formats from (
    select distinct x as f from jsonb_array_elements_text(coalesce(p->'formats', '[]'::jsonb)) x
     where x in ('hotpot','bbq','dimsum','noodles','seafood','buffet','brunch','veg') limit 3
  ) s;
  if v_vtype is not null and v_vtype not in ('fast','casual','dine','cafe','bar') then v_vtype := null; end if;

  if p->'venue' is not null and jsonb_typeof(p->'venue') = 'object' and nullif(btrim(p->'venue'->>'name'), '') is not null then
    insert into public.venues (name, address, latitude, longitude, map_poi_id, cuisine_slug, created_by)
    values (left(p->'venue'->>'name', 120), left(p->'venue'->>'address', 240),
            nullif(p->'venue'->>'lat', '')::numeric, nullif(p->'venue'->>'lng', '')::numeric,
            p->'venue'->>'poi_id', nullif(p->>'cuisine', ''), me)
    returning id into v_venue;
  end if;

  insert into public.dining_tables (host_id, area_id, title, audience, starts_at, capacity, budget_cents, cuisine_slug, formats, venue_type,
                                    venue_id, area_label, meet_lat, meet_lng, tags, occasion, note, join_mode, is_private)
  values (me, nullif(p->>'area_id', '')::uuid, v_title, coalesce(p->>'audience', 'friends_and_new'), v_starts, v_cap,
          nullif(p->>'budget_cents', '')::int, nullif(p->>'cuisine', ''), v_formats, v_vtype, v_venue, left(p->>'area_label', 120),
          nullif(p->>'meet_lat', '')::numeric, nullif(p->>'meet_lng', '')::numeric, v_tags, nullif(p->>'occasion', ''), v_note,
          case when v_private then 'instant' else coalesce(p->>'join_mode', 'request') end, v_private)
  returning id into v_id;

  insert into public.table_members (table_id, user_id, role, status, joined_at, intention, pace)
  values (v_id, me, 'host', 'joined', now(), nullif(p->>'intention', ''), nullif(p->>'pace', ''));

  perform public.refresh_table_status(v_id);
  return jsonb_build_object('id', v_id);
end $$;

-- A craving is a cuisine or one of the formats.
create or replace function public.set_my_craving(p_table uuid, p_cuisine text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); v text := nullif(p_cuisine, '');
begin
  if v is not null and not (exists (select 1 from public.cuisines where slug = v)
                            or v in ('hotpot','bbq','dimsum','noodles','seafood','buffet','brunch','veg')) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  update public.table_members set cuisine_slug = v
   where table_id = p_table and user_id = me and status in ('requested', 'joined');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.list_my_feelings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'table_id', f.table_id, 'overall', f.overall, 'mood_before', f.mood_before, 'mood_after', f.mood_after,
             'vibes', to_jsonb(f.vibes), 'created_at', f.created_at,
             'cuisine', t.cuisine_slug, 'formats', to_jsonb(t.formats), 'venue_type', t.venue_type,
             'occasion', t.occasion, 'starts_at', t.starts_at,
             'seats', (select count(*) from public.table_members m where m.table_id = t.id and m.status = 'joined'),
             'title', t.title
           ) order by t.starts_at desc)
      from public.table_feelings f join public.dining_tables t on t.id = f.table_id
     where f.user_id = me
  ), '[]'::jsonb);
end $$;

-- ===== 2026-11-16_multi_cuisine =====
-- Tables can have up to three cuisines (e.g. Sichuan + Hunan). cuisine_slug stays as the first one so older code keeps working.
alter table public.dining_tables add column if not exists cuisines text[] not null default '{}';
alter table public.dining_tables drop constraint if exists dining_tables_cuisines_chk;
alter table public.dining_tables add constraint dining_tables_cuisines_chk check (cardinality(cuisines) <= 3);
update public.dining_tables set cuisines = array[cuisine_slug] where cuisine_slug is not null and cuisines = '{}';

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

create or replace function public.create_table(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  -- up to three formats, only the known ones
  select coalesce(array_agg(f), '{}') into v_formats from (
    select distinct x as f from jsonb_array_elements_text(coalesce(p->'formats', '[]'::jsonb)) x
     where x in ('hotpot','bbq','dimsum','noodles','seafood','buffet','brunch','veg') limit 3
  ) s;
  -- up to three cuisines, only the known ones; the first one is the table's main cuisine
  select coalesce(array_agg(c order by o), '{}') into v_cuisines from (
    select x.c, min(x.o) o from jsonb_array_elements_text(
      coalesce(p->'cuisines', case when nullif(p->>'cuisine','') is not null then jsonb_build_array(p->>'cuisine') else '[]'::jsonb end)
    ) with ordinality as x(c, o)
    where exists (select 1 from public.cuisines k where k.slug = x.c) group by x.c order by min(x.o) limit 3
  ) s;
  if v_vtype is not null and v_vtype not in ('fast','casual','dine','cafe','bar') then v_vtype := null; end if;

  if p->'venue' is not null and jsonb_typeof(p->'venue') = 'object' and nullif(btrim(p->'venue'->>'name'), '') is not null then
    insert into public.venues (name, address, latitude, longitude, map_poi_id, cuisine_slug, created_by)
    values (left(p->'venue'->>'name', 120), left(p->'venue'->>'address', 240),
            nullif(p->'venue'->>'lat', '')::numeric, nullif(p->'venue'->>'lng', '')::numeric,
            p->'venue'->>'poi_id', v_cuisines[1], me)
    returning id into v_venue;
  end if;

  insert into public.dining_tables (host_id, area_id, title, audience, starts_at, capacity, budget_cents, cuisine_slug, cuisines, formats, venue_type,
                                    venue_id, area_label, meet_lat, meet_lng, tags, occasion, note, join_mode, is_private)
  values (me, nullif(p->>'area_id', '')::uuid, v_title, coalesce(p->>'audience', 'friends_and_new'), v_starts, v_cap,
          nullif(p->>'budget_cents', '')::int, v_cuisines[1], v_cuisines, v_formats, v_vtype, v_venue, left(p->>'area_label', 120),
          nullif(p->>'meet_lat', '')::numeric, nullif(p->>'meet_lng', '')::numeric, v_tags, nullif(p->>'occasion', ''), v_note,
          case when v_private then 'instant' else coalesce(p->>'join_mode', 'request') end, v_private)
  returning id into v_id;

  insert into public.table_members (table_id, user_id, role, status, joined_at, intention, pace)
  values (v_id, me, 'host', 'joined', now(), nullif(p->>'intention', ''), nullif(p->>'pace', ''));

  perform public.refresh_table_status(v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.list_my_feelings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'table_id', f.table_id, 'overall', f.overall, 'mood_before', f.mood_before, 'mood_after', f.mood_after,
             'vibes', to_jsonb(f.vibes), 'created_at', f.created_at,
             'cuisine', t.cuisine_slug, 'cuisines', to_jsonb(t.cuisines), 'formats', to_jsonb(t.formats), 'venue_type', t.venue_type,
             'occasion', t.occasion, 'starts_at', t.starts_at,
             'seats', (select count(*) from public.table_members m where m.table_id = t.id and m.status = 'joined'),
             'title', t.title
           ) order by t.starts_at desc)
      from public.table_feelings f join public.dining_tables t on t.id = f.table_id
     where f.user_id = me
  ), '[]'::jsonb);
end $$;

-- ===== 2026-11-20 currency =====
-- Each table remembers its own currency (set from where the host is), so people elsewhere see "¥3000" or "€25" instead of Canadian dollars.
-- Budgets are stored as amount x 100 in that currency; the old $5-$500 limits no longer fit yen or won.
alter table public.dining_tables add column if not exists currency text not null default 'CAD';
alter table public.dining_tables drop constraint if exists dining_tables_currency_chk;
alter table public.dining_tables add constraint dining_tables_currency_chk check (currency ~ '^[A-Z]{3}$');
alter table public.dining_tables drop constraint if exists dining_tables_budget_cents_check;
alter table public.dining_tables add constraint dining_tables_budget_cents_check check (budget_cents >= 0 and budget_cents <= 100000000);
alter table public.profiles drop constraint if exists profiles_budget_cents_check;
alter table public.profiles add constraint profiles_budget_cents_check check (budget_cents >= 0 and budget_cents <= 100000000);

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

create or replace function public.create_table(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
begin
  if v_starts is null or v_starts < now() then raise exception 'start_in_past' using errcode = '22023'; end if;
  if v_cap is null or v_cap < 2 or v_cap > 12 then raise exception 'bad_capacity' using errcode = '22023'; end if;
  if (select count(*) from public.dining_tables where host_id = me and created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  select coalesce(array_agg(x), '{}') into v_tags from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) x;
  -- up to three formats, only the known ones
  select coalesce(array_agg(f), '{}') into v_formats from (
    select distinct x as f from jsonb_array_elements_text(coalesce(p->'formats', '[]'::jsonb)) x
     where x in ('hotpot','bbq','dimsum','noodles','seafood','buffet','brunch','veg') limit 3
  ) s;
  -- up to three cuisines, only the known ones; the first one is the table's main cuisine
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
                                    venue_id, area_label, meet_lat, meet_lng, tags, occasion, note, join_mode, is_private)
  values (me, nullif(p->>'area_id', '')::uuid, v_title, coalesce(p->>'audience', 'friends_and_new'), v_starts, v_cap,
          nullif(p->>'budget_cents', '')::int, v_cur, v_cuisines[1], v_cuisines, v_formats, v_vtype, v_venue, left(p->>'area_label', 120),
          nullif(p->>'meet_lat', '')::numeric, nullif(p->>'meet_lng', '')::numeric, v_tags, nullif(p->>'occasion', ''), v_note,
          case when v_private then 'instant' else coalesce(p->>'join_mode', 'request') end, v_private)
  returning id into v_id;

  insert into public.table_members (table_id, user_id, role, status, joined_at, intention, pace)
  values (v_id, me, 'host', 'joined', now(), nullif(p->>'intention', ''), nullif(p->>'pace', ''));

  perform public.refresh_table_status(v_id);
  return jsonb_build_object('id', v_id);
end $$;
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
-- Dietary needs: a fixed list on the profile (set once) and, per table, what this person needs at THIS meal
-- (their fixed ones plus anything extra). The host, the person, and everyone at a private friends table can see a member's needs.
alter table public.profiles add column if not exists dietary_tags text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_dietary_tags_chk;
alter table public.profiles add constraint profiles_dietary_tags_chk check (cardinality(dietary_tags) <= 16);
grant update (dietary_tags) on public.profiles to authenticated;

alter table public.table_members add column if not exists diet_tags text[] not null default '{}';
alter table public.table_members add column if not exists diet_note text;
alter table public.table_members drop constraint if exists table_members_diet_chk;
alter table public.table_members add constraint table_members_diet_chk check (cardinality(diet_tags) <= 16 and char_length(coalesce(diet_note, '')) <= 200);

create or replace function public.set_my_diet(p_table uuid, p_tags text[], p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  update public.table_members
     set diet_tags = coalesce((array(select distinct x from unnest(coalesce(p_tags, '{}')) x where x ~ '^[a-z_]{2,24}$'))[1:16], '{}'),
         diet_note = nullif(left(btrim(coalesce(p_note, '')), 200), '')
   where table_id = p_table and user_id = me and status in ('requested', 'joined');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_my_diet(uuid, text[], text) from public, anon;
grant execute on function public.set_my_diet(uuid, text[], text) to authenticated;

create or replace function public.get_table(p_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
  -- On a private friend table, everyone who has joined can see each other's starting point, craving and dietary needs.
  can_see := is_host or exists (select 1 from public.table_members x where x.table_id = p_id and x.user_id = me and x.status = 'joined');

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'role', m.role,
           'status', m.status,
           'display_name', p.display_name,
           'avatar_emoji', p.avatar_emoji,
           'no_show_count', case when is_host then p.no_show_count else null end,
           'start_label', case when is_host or m.user_id = me or (t.is_private and can_see) then m.start_label end,
           'start_lat', case when is_host or m.user_id = me or (t.is_private and can_see) then m.start_lat end,
           'start_lng', case when is_host or m.user_id = me or (t.is_private and can_see) then m.start_lng end,
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

  return public.table_json(t, me) || jsonb_build_object('members', members, 'my_membership', coalesce(mine, 'null'::jsonb));
end $function$;
