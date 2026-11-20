-- Hard in-app cap on Google map loads, kept below Google's free monthly allowance (10,000 Dynamic Maps loads).
-- The app calls claim_google_map() before it creates a Google map; false = use the free built-in map instead.
-- Limits: 8,000 per month and 300 per day for everybody, 40 per day per person. Guests never get Google maps.
create table if not exists public.google_map_usage (period text primary key, n integer not null default 0);
create table if not exists public.google_map_user_usage (user_id uuid not null, day date not null, n integer not null default 0, primary key (user_id, day));
alter table public.google_map_usage enable row level security;
alter table public.google_map_user_usage enable row level security;
revoke all on public.google_map_usage, public.google_map_user_usage from anon, authenticated;

create or replace function public.claim_google_map() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  d date := (now() at time zone 'utc')::date;
  mk text := 'm:' || to_char(now() at time zone 'utc', 'YYYY-MM');
  dk text := 'd:' || d::text;
  u integer; g integer; m integer;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return false; end if;
  insert into google_map_user_usage (user_id, day, n) values (me, d, 0) on conflict do nothing;
  insert into google_map_usage (period, n) values (mk, 0), (dk, 0) on conflict do nothing;
  update google_map_user_usage set n = n + 1 where user_id = me and day = d and n < 40 returning n into u;
  if u is null then return false; end if;
  update google_map_usage set n = n + 1 where period = dk and n < 300 returning n into g;
  if g is null then
    update google_map_user_usage set n = n - 1 where user_id = me and day = d;
    return false;
  end if;
  update google_map_usage set n = n + 1 where period = mk and n < 8000 returning n into m;
  if m is null then
    update google_map_usage set n = n - 1 where period = dk;
    update google_map_user_usage set n = n - 1 where user_id = me and day = d;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.claim_google_map() from public, anon;
grant execute on function public.claim_google_map() to authenticated;
