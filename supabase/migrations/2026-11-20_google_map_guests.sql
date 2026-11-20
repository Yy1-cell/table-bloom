-- Let guests (anonymous sign-ins) use the Google map too, for the small friends-only test phase.
-- Cost protection is unchanged: 8,000 per month for everybody (Google's free allowance is 10,000), 40 per day per person.
-- The daily total goes from 300 to 500 so ~30 testers are not cut off early; 500/day can never exceed the monthly 8,000 cap.
create or replace function public.claim_google_map() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  d date := (now() at time zone 'utc')::date;
  mk text := 'm:' || to_char(now() at time zone 'utc', 'YYYY-MM');
  dk text := 'd:' || d::text;
  u integer; g integer; m integer;
begin
  insert into google_map_user_usage (user_id, day, n) values (me, d, 0) on conflict do nothing;
  insert into google_map_usage (period, n) values (mk, 0), (dk, 0) on conflict do nothing;
  update google_map_user_usage set n = n + 1 where user_id = me and day = d and n < 40 returning n into u;
  if u is null then return false; end if;
  update google_map_usage set n = n + 1 where period = dk and n < 500 returning n into g;
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
