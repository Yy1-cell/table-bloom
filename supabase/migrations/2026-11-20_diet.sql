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
