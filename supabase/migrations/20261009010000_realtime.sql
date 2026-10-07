-- Live updates on the release page. RLS still applies to realtime events.
alter publication supabase_realtime add table public.release_tasks, public.reports, public.approvals, public.releases;
