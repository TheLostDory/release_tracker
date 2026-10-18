-- The latest "Code vs Jira" result per release, so lists and the dashboard can
-- show mismatches without asking GitHub/Jira for every release. Written each
-- time a comparison runs (by anyone who can see the release).

create table release_code_checks (
  release_id      uuid primary key references releases (id) on delete cascade,
  -- In the Jira version, nothing merged mentions them (of which marked Done).
  jira_only       integer not null,
  jira_only_done  integer not null,
  -- Merged changes mention issues outside the version.
  code_only       integer not null,
  -- Merged pull requests / branch merges without any issue key.
  no_key          integer not null,
  matched         integer not null,
  total_commits   integer not null,
  -- False when the release isn't linked to a Jira version (code side only).
  has_jira        boolean not null,
  error           text,
  checked_at      timestamptz not null default now()
);

alter table release_code_checks enable row level security;
create policy code_checks_read on release_code_checks for select using (release_id in (select my_release_ids('VIEWER')));
grant select on release_code_checks to release_tracker_app;

create function record_code_check(p_release uuid, p jsonb) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_release not in (select my_release_ids('VIEWER')) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into release_code_checks as c (release_id, jira_only, jira_only_done, code_only, no_key, matched, total_commits, has_jira, error, checked_at)
  values (p_release, (p ->> 'jiraOnly')::int, (p ->> 'jiraOnlyDone')::int, (p ->> 'codeOnly')::int, (p ->> 'noKey')::int,
          (p ->> 'matched')::int, (p ->> 'totalCommits')::int, (p ->> 'hasJira')::boolean, p ->> 'error', now())
  on conflict (release_id) do update
  set jira_only = excluded.jira_only, jira_only_done = excluded.jira_only_done, code_only = excluded.code_only,
      no_key = excluded.no_key, matched = excluded.matched, total_commits = excluded.total_commits,
      has_jira = excluded.has_jira, error = excluded.error, checked_at = excluded.checked_at;
end;
$$;

-- Choosing other branches makes the old result meaningless.
create function clear_code_check(p_release uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_release not in (select my_release_ids('MEMBER')) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from release_code_checks where release_id = p_release;
end;
$$;
grant execute on function record_code_check(uuid, jsonb), clear_code_check(uuid) to release_tracker_app;

-- Live updates when a result changes (not on every re-check with the same result).
create trigger release_code_checks_notify_insert after insert or delete on release_code_checks
  for each row execute function notify_release_change();
create trigger release_code_checks_notify_update after update on release_code_checks
  for each row
  when ((old.jira_only, old.code_only, old.no_key, old.matched, old.has_jira, old.error)
        is distinct from (new.jira_only, new.code_only, new.no_key, new.matched, new.has_jira, new.error))
  execute function notify_release_change();
