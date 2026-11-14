-- Post-meal 30-second check-in ("同桌快评") + private "would eat with again" signals. Safe to re-run.
--
-- Visibility ladder:
--   * mood_before / mood_after / note / private vibes / peer signals  -> only the author, ever.
--   * overall feeling + positive vibe tags -> other people AT THAT TABLE, but only after they have
--     submitted their own (so nobody anchors on what others said), only if the author left "shared" on,
--     and never across a block.
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
