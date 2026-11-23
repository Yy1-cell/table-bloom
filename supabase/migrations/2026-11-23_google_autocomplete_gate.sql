-- Google Autocomplete for the search boxes (find any place by name), behind a free-allowance gate like claim_google_places().
-- Google gives 10,000 free "Autocomplete Requests" and 10,000 free "Place Details Essentials" a month.
-- The app asks claim_google_autocomplete() before EVERY suggestion request and before the final details call,
-- so both together stay under 9,000 a month. Also 300 a day for everybody and 60 a day per person.
-- false = the search box uses the free search instead. Nothing is billed beyond the free allowance.
create table if not exists public.google_ac_usage (period text primary key, n integer not null default 0);
create table if not exists public.google_ac_user_usage (user_id uuid not null, day date not null, n integer not null default 0, primary key (user_id, day));
alter table public.google_ac_usage enable row level security;
alter table public.google_ac_user_usage enable row level security;
revoke all on public.google_ac_usage, public.google_ac_user_usage from anon, authenticated;

create or replace function public.claim_google_autocomplete() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  d date := (now() at time zone 'utc')::date;
  mk text := 'm:' || to_char(now() at time zone 'utc', 'YYYY-MM');
  dk text := 'd:' || d::text;
  u integer; g integer; m integer;
begin
  insert into google_ac_user_usage (user_id, day, n) values (me, d, 0) on conflict do nothing;
  insert into google_ac_usage (period, n) values (mk, 0), (dk, 0) on conflict do nothing;
  update google_ac_user_usage set n = n + 1 where user_id = me and day = d and n < 60 returning n into u;
  if u is null then return false; end if;
  update google_ac_usage set n = n + 1 where period = dk and n < 300 returning n into g;
  if g is null then
    update google_ac_user_usage set n = n - 1 where user_id = me and day = d;
    return false;
  end if;
  update google_ac_usage set n = n + 1 where period = mk and n < 9000 returning n into m;
  if m is null then
    update google_ac_usage set n = n - 1 where period = dk;
    update google_ac_user_usage set n = n - 1 where user_id = me and day = d;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.claim_google_autocomplete() from public, anon;
grant execute on function public.claim_google_autocomplete() to authenticated;
