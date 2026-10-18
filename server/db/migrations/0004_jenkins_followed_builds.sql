-- Followed Jenkins builds: a specific run linked to a release (pasted link),
-- shown with its live status and the status of every build it started.
-- Only displayed; it doesn't change the workflow.

create table release_jenkins_builds (
  id              uuid primary key default gen_random_uuid(),
  release_id      uuid not null references releases (id) on delete cascade,
  job_path        text not null,
  build_number    integer not null,
  label           text,
  -- Last known status of the build and its downstream builds (a tree).
  status          jsonb,
  last_synced_at  timestamptz,
  last_error      text,
  created_by      uuid references users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint release_jenkins_builds_unique unique (release_id, job_path, build_number),
  constraint release_jenkins_builds_path_check check (length(job_path) between 1 and 300 and job_path !~ '(^|/)\.\.(/|$)'),
  constraint release_jenkins_builds_number_check check (build_number > 0),
  constraint release_jenkins_builds_label_check check (label is null or length(label) <= 100)
);
create index release_jenkins_builds_release_idx on release_jenkins_builds (release_id);

alter table release_jenkins_builds enable row level security;
create policy jenkins_builds_read on release_jenkins_builds for select using (release_id in (select my_release_ids('VIEWER')));
create policy jenkins_builds_insert on release_jenkins_builds for insert with check (release_id in (select my_release_ids('MEMBER')));
create policy jenkins_builds_delete on release_jenkins_builds for delete using (release_id in (select my_release_ids('MEMBER')));

grant select, delete on release_jenkins_builds to release_tracker_app;
grant insert (release_id, job_path, build_number, label, status, last_synced_at, last_error, created_by)
  on release_jenkins_builds to release_tracker_app;

-- Anyone who can see the release may refresh the stored status (it is only a
-- cache of what Jenkins reports); nothing else of the row can change.
create function jenkins_followed_record(p_id uuid, p_status jsonb, p_error text default null) returns void
language sql security definer set search_path = public
as $$
  update release_jenkins_builds
  set status = coalesce(p_status, status), last_error = p_error, last_synced_at = now()
  where id = p_id and release_id in (select my_release_ids('VIEWER'))
$$;
grant execute on function jenkins_followed_record(uuid, jsonb, text) to release_tracker_app;
