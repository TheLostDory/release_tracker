-- Automation: Code vs Jira re-checked in the background, with a Teams alert
-- when a release's differences go up. Also new Teams event kinds (reminders).

-- The background check (no signed-in user) records results too.
create or replace function record_code_check(p_release uuid, p jsonb) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if app_user_id() is not null and p_release not in (select my_release_ids('VIEWER')) then
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

alter table notification_outbox drop constraint notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('blocked', 'jenkins', 'daily', 'code', 'due_soon', 'approval'));

-- More differences than before → Teams (if the project wants "code" events).
create function notify_code_check() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r releases;
  diffs integer := new.jira_only + new.code_only + new.no_key;
  before integer := 0;
begin
  if not new.has_jira or new.error is not null then return null; end if;
  if tg_op = 'UPDATE' and old.has_jira and old.error is null then
    before := old.jira_only + old.code_only + old.no_key;
  end if;
  if diffs <= before then return null; end if;
  select * into r from releases where id = new.release_id;
  if r.actual_deployment_date is not null or not teams_wants(r.project_id, 'code') then return null; end if;
  insert into notification_outbox (project_id, release_id, kind, payload)
  values (r.project_id, r.id, 'code', jsonb_build_object(
    'release', jsonb_build_object('id', r.id, 'name', r.name, 'version', r.version),
    'differences', diffs, 'previous', before,
    'jiraOnly', new.jira_only, 'jiraOnlyDone', new.jira_only_done, 'codeOnly', new.code_only, 'noKey', new.no_key));
  return null;
end;
$$;
create trigger release_code_checks_notify_teams after insert or update on release_code_checks
  for each row execute function notify_code_check();

-- Open releases with a comparison set up, not checked within the last 55 minutes.
create function code_check_targets()
returns table (release_id uuid, project_id uuid, name text, version text, jira_version_id text, jira_version_name text,
               refs jsonb,
               gh_id uuid, gh_base_url text, gh_secret text, gh_ca text, gh_settings jsonb,
               jira_id uuid, jira_base_url text, jira_auth integration_auth, jira_username text, jira_secret text, jira_ca text, jira_settings jsonb)
language sql stable security definer set search_path = public
as $$
  select r.id, r.project_id, r.name, r.version, r.jira_version_id, r.jira_version_name,
         (select jsonb_agg(jsonb_build_object('repo', c.repo, 'base_ref', c.base_ref, 'head_ref', c.head_ref) order by c.repo)
          from release_code_refs c where c.release_id = r.id),
         gh.id, gh.base_url, gh.secret_encrypted, gh.ca_cert, gh.settings,
         ji.id, ji.base_url, ji.auth_type, ji.username, ji.secret_encrypted, ji.ca_cert, ji.settings
  from releases r
  join projects p on p.id = r.project_id
  join integrations gh on gh.project_id = r.project_id and gh.kind = 'GITHUB'
  left join integrations ji on ji.project_id = r.project_id and ji.kind = 'JIRA'
  left join release_code_checks cc on cc.release_id = r.id
  where r.actual_deployment_date is null
    and coalesce((p.automation -> 'codeCheck' ->> 'background')::boolean, true)
    and exists (select 1 from release_code_refs c where c.release_id = r.id)
    and (cc.checked_at is null or cc.checked_at < now() - interval '55 minutes')
$$;
grant execute on function code_check_targets() to release_tracker_app;
