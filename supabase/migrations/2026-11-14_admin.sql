-- Operator ("admin") console. Safe to re-run.
-- Who is an admin: a signed-in (non-guest) account whose verified e-mail is in app_admins.
-- What an admin can see/do: accounts (e-mail masked), tables, reports; cancel tables, suspend accounts, delete test accounts.
-- What an admin can NOT see (by design, same as everyone else): journal reflections, post-meal check-ins,
-- "eat again" lists. None of these functions touch reflections / table_feelings / peer_signals.
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
