-- Security advisor fix: trigger functions should not be callable as RPCs
-- through /rest/v1/rpc. Triggers still run normally after this.
revoke execute on function public.tables_safety_guard()  from public, anon, authenticated;
revoke execute on function public.members_safety_guard() from public, anon, authenticated;
