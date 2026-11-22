-- Google Places text search (the Map tab's restaurant list) behind a free-allowance gate, like claim_google_map().
-- Google gives 5,000 free "Text Search Pro" calls a month. The app asks claim_google_places() before each search;
-- false = use the free built-in list instead. Limits: 4,500 per month and 150 per day for everybody, 30 per day per person.
-- Guests may use it too (testing phase). Results are cached in the browser, so repeating a search costs nothing.
create table if not exists public.google_places_usage (period text primary key, n integer not null default 0);
create table if not exists public.google_places_user_usage (user_id uuid not null, day date not null, n integer not null default 0, primary key (user_id, day));
alter table public.google_places_usage enable row level security;
alter table public.google_places_user_usage enable row level security;
revoke all on public.google_places_usage, public.google_places_user_usage from anon, authenticated;

create or replace function public.claim_google_places() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  d date := (now() at time zone 'utc')::date;
  mk text := 'm:' || to_char(now() at time zone 'utc', 'YYYY-MM');
  dk text := 'd:' || d::text;
  u integer; g integer; m integer;
begin
  insert into google_places_user_usage (user_id, day, n) values (me, d, 0) on conflict do nothing;
  insert into google_places_usage (period, n) values (mk, 0), (dk, 0) on conflict do nothing;
  update google_places_user_usage set n = n + 1 where user_id = me and day = d and n < 30 returning n into u;
  if u is null then return false; end if;
  update google_places_usage set n = n + 1 where period = dk and n < 150 returning n into g;
  if g is null then
    update google_places_user_usage set n = n - 1 where user_id = me and day = d;
    return false;
  end if;
  update google_places_usage set n = n + 1 where period = mk and n < 4500 returning n into m;
  if m is null then
    update google_places_usage set n = n - 1 where period = dk;
    update google_places_user_usage set n = n - 1 where user_id = me and day = d;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.claim_google_places() from public, anon;
grant execute on function public.claim_google_places() to authenticated;
