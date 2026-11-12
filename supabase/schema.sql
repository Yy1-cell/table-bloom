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
    'note', t.note,
    'join_mode', t.join_mode,
    'status', t.status,
    'is_sample', t.is_sample,
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
  members jsonb;
  mine jsonb;
begin
  select * into t from public.dining_tables where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.host_id is not null and t.host_id <> me and public.is_blocked_pair(me, t.host_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  is_host := (t.host_id = me);

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'role', m.role,
           'status', m.status,
           'display_name', p.display_name,
           'avatar_emoji', p.avatar_emoji,
           'no_show_count', case when is_host then p.no_show_count else null end,
           -- start points are visible to the host (to suggest a fair meeting point) and to the person themselves
           'start_label', case when is_host or m.user_id = me then m.start_label end,
           'start_lat', case when is_host or m.user_id = me then m.start_lat end,
           'start_lng', case when is_host or m.user_id = me then m.start_lng end
         ) order by m.joined_at nulls last, m.requested_at), '[]'::jsonb)
    into members
    from public.table_members m
    join public.profiles p on p.id = m.user_id
   where m.table_id = p_id
     and (m.status = 'joined' or (is_host and m.status = 'requested') or m.user_id = me)
     and (m.user_id = me or not public.is_blocked_pair(me, m.user_id));

  select jsonb_build_object('start_label', m.start_label, 'start_lat', m.start_lat, 'start_lng', m.start_lng,
                            'intention', m.intention, 'pace', m.pace)
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
                                    venue_id, area_label, meet_lat, meet_lng, tags, note, join_mode)
  values (me, nullif(p->>'area_id', '')::uuid, v_title, coalesce(p->>'audience', 'friends_and_new'), v_starts, v_cap,
          nullif(p->>'budget_cents', '')::int, nullif(p->>'cuisine', ''), v_venue, left(p->>'area_label', 120),
          nullif(p->>'meet_lat', '')::numeric, nullif(p->>'meet_lng', '')::numeric, v_tags, v_note,
          coalesce(p->>'join_mode', 'request'))
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
  if not found or t.host_id is distinct from me then raise exception 'not_allowed' using errcode = '42501'; end if;
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
insert into public.cuisines (slug, name_en, name_zh, emoji, sort) values
  ('hotpot',     'Hot pot',      '火锅', '🥘', 1),
  ('korean_bbq', 'Korean BBQ',   '韩烤', '🍖', 2),
  ('japanese',   'Japanese',     '日料', '🍣', 3),
  ('sichuan',    'Sichuan',      '川菜', '🌶️', 4),
  ('noodles',    'Noodles',      '面食', '🍜', 5),
  ('pizza',      'Pizza',        '披萨', '🍕', 6),
  ('dimsum',     'Dim sum',      '点心', '🥟', 7),
  ('cafe',       'Café & brunch','咖啡轻食', '☕', 8)
on conflict (slug) do update set name_en = excluded.name_en, name_zh = excluded.name_zh, emoji = excluded.emoji, sort = excluded.sort;

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
