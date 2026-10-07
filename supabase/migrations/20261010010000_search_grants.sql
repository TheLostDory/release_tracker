-- Functions are executable by PUBLIC by default; revoking from anon alone is
-- not enough. Only signed-in users may search (RLS would return nothing to
-- anon anyway, but refuse outright).
revoke execute on function public.search_releases(text, int) from public, anon;
grant execute on function public.search_releases(text, int) to authenticated;
