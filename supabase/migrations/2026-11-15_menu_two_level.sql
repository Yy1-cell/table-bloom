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
