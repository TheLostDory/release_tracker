-- Jira and Jenkins integrations (per project).
--
-- Credentials are encrypted by the API (AES-256-GCM, ENCRYPTION_KEY) before
-- they reach the database, and the app role can write but never SELECT the
-- secret column: reading it goes through integration_secret(), which checks
-- project membership.

create type integration_kind as enum ('JIRA', 'JENKINS');
-- JIRA_CLOUD: email + API token (Basic). JIRA_SERVER: personal access token (Bearer).
-- JENKINS: user + API token (Basic).
create type integration_auth as enum ('JIRA_CLOUD', 'JIRA_SERVER', 'JENKINS');
create type jenkins_job_purpose as enum ('AUTOMATED', 'LOAD_TEST', 'LONGEVITY', 'HIT', 'OTHER');

create table integrations (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects (id) on delete cascade,
  kind              integration_kind not null,
  auth_type         integration_auth not null,
  base_url          text not null,
  username          text,
  secret_encrypted  text not null,
  -- Jira: {"projectKey": "ABC"}
  settings          jsonb not null default '{}'::jsonb,
  last_error        text,
  last_checked_at   timestamptz,
  created_by        uuid references users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint integrations_one_per_kind unique (project_id, kind),
  constraint integrations_base_url_check check (base_url ~* '^https?://[^\s/]+(/[^\s]*)?$' and length(base_url) <= 500),
  constraint integrations_auth_matches_kind check (
    (kind = 'JIRA' and auth_type in ('JIRA_CLOUD', 'JIRA_SERVER')) or (kind = 'JENKINS' and auth_type = 'JENKINS')
  )
);
create trigger integrations_set_updated_at before update on integrations for each row execute function set_updated_at();

-- A release can be linked to one Jira version.
alter table releases
  add column jira_version_id text,
  add column jira_version_name text,
  add constraint releases_jira_version_id_check check (jira_version_id is null or jira_version_id ~ '^\d{1,20}$');
create index releases_jira_version_idx on releases (project_id, jira_version_id) where jira_version_id is not null;

create table release_jenkins_jobs (
  id              uuid primary key default gen_random_uuid(),
  release_id      uuid not null references releases (id) on delete cascade,
  job_path        text not null,
  purpose         jenkins_job_purpose not null,
  -- Build parameters; values may use {{version}} and {{name}}.
  parameters      jsonb not null default '{}'::jsonb,
  last_build      jsonb,
  last_synced_at  timestamptz,
  last_error      text,
  created_by      uuid references users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint release_jenkins_jobs_unique unique (release_id, job_path, purpose),
  constraint release_jenkins_jobs_path_check check (length(job_path) between 1 and 300 and job_path !~ '(^|/)\.\.(/|$)')
);
create index release_jenkins_jobs_release_idx on release_jenkins_jobs (release_id);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table integrations enable row level security;
alter table release_jenkins_jobs enable row level security;

-- Members see that an integration exists (not its secret); admins manage it.
create policy integrations_read on integrations for select using (project_id in (select my_project_ids('VIEWER')));
create policy integrations_insert on integrations for insert with check (project_id in (select my_project_ids('ADMIN')));
create policy integrations_update on integrations for update
  using (project_id in (select my_project_ids('ADMIN'))) with check (project_id in (select my_project_ids('ADMIN')));
create policy integrations_delete on integrations for delete using (project_id in (select my_project_ids('ADMIN')));

create policy jenkins_jobs_read on release_jenkins_jobs for select using (release_id in (select my_release_ids('VIEWER')));
create policy jenkins_jobs_insert on release_jenkins_jobs for insert with check (release_id in (select my_release_ids('MEMBER')));
create policy jenkins_jobs_update on release_jenkins_jobs for update
  using (release_id in (select my_release_ids('MEMBER'))) with check (release_id in (select my_release_ids('MEMBER')));
create policy jenkins_jobs_delete on release_jenkins_jobs for delete using (release_id in (select my_release_ids('MEMBER')));

-- No SELECT on secret_encrypted for the app role (write-only).
grant select (id, project_id, kind, auth_type, base_url, username, settings, last_error, last_checked_at,
              created_by, created_at, updated_at)
  on integrations to release_tracker_app;
grant insert (project_id, kind, auth_type, base_url, username, secret_encrypted, settings, created_by, last_checked_at)
  on integrations to release_tracker_app;
grant update (auth_type, base_url, username, secret_encrypted, settings, last_error, last_checked_at)
  on integrations to release_tracker_app;
grant delete on integrations to release_tracker_app;
grant select, insert, update, delete on release_jenkins_jobs to release_tracker_app;
grant update (jira_version_id, jira_version_name) on releases to release_tracker_app;

-- Decrypting needs the secret: only for members of the integration's project.
create function integration_secret(p_integration uuid) returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  result text;
begin
  select i.secret_encrypted into result
  from integrations i
  where i.id = p_integration and i.project_id in (select my_project_ids('VIEWER'));
  if result is null then
    raise exception 'Integration not found' using errcode = 'no_data_found';
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Background Jenkins sync (no signed-in user). The server's poller uses these
-- two functions only; everything they change is logged as "Jenkins".
-- ---------------------------------------------------------------------------

-- Jobs linked to releases that aren't deployed yet, with their Jenkins connection.
create function jenkins_jobs_to_sync()
returns table (job_id uuid, release_id uuid, project_id uuid, job_path text, purpose jenkins_job_purpose,
               integration_id uuid, base_url text, username text, secret_encrypted text, last_build jsonb)
language sql stable security definer set search_path = public
as $$
  select j.id, r.id, r.project_id, j.job_path, j.purpose, i.id, i.base_url, i.username, i.secret_encrypted, j.last_build
  from release_jenkins_jobs j
  join releases r on r.id = j.release_id
  join integrations i on i.project_id = r.project_id and i.kind = 'JENKINS'
  where r.actual_deployment_date is null
$$;

-- Stores a job's latest build and applies its effect on the workflow:
--   AUTOMATED jobs drive the "Automated jobs" step (all passing → completed,
--   any failing → blocked, any running → in progress).
--   Report jobs fill the report URL while it is empty or still Jenkins-set.
create function jenkins_record_build(p_job uuid, p_build jsonb, p_error text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  job release_jenkins_jobs;
  prev jsonb;
  results text[];
  target task_status;
  reason text;
  step release_tasks;
  report_kind report_type;
  url text;
begin
  select * into job from release_jenkins_jobs where id = p_job;
  if job.id is null then return; end if;
  prev := job.last_build;

  update release_jenkins_jobs
  set last_build = coalesce(p_build, last_build), last_synced_at = now(), last_error = p_error
  where id = p_job;

  if p_build is null then return; end if;

  -- New finished build → activity entry (once per build number).
  if (prev is null or prev ->> 'number' is distinct from p_build ->> 'number' or (prev ->> 'building')::boolean)
     and not coalesce((p_build ->> 'building')::boolean, false) then
    insert into activity_log (release_id, user_id, action, description, metadata)
    values (job.release_id, null, 'jenkins.build',
            format('Jenkins: %s #%s %s', job.job_path, p_build ->> 'number', lower(coalesce(p_build ->> 'result', 'unknown'))),
            jsonb_build_object('job_id', job.id, 'build', p_build));
  end if;

  if job.purpose = 'AUTOMATED' then
    select array_agg(case when coalesce((b.last_build ->> 'building')::boolean, false) then 'BUILDING'
                          else coalesce(b.last_build ->> 'result', 'NONE') end)
    into results
    from release_jenkins_jobs b where b.release_id = job.release_id and b.purpose = 'AUTOMATED';

    select * into step from release_tasks where release_id = job.release_id and task_type = 'AUTOMATED_JOBS';
    if step.id is null or step.status = 'SKIPPED' then return; end if;

    if results && array['FAILURE', 'UNSTABLE', 'ABORTED'] then
      target := 'BLOCKED';
      select string_agg(format('%s #%s %s', b.job_path, b.last_build ->> 'number', lower(b.last_build ->> 'result')), ', ')
      into reason
      from release_jenkins_jobs b
      where b.release_id = job.release_id and b.purpose = 'AUTOMATED'
        and b.last_build ->> 'result' in ('FAILURE', 'UNSTABLE', 'ABORTED')
        and not coalesce((b.last_build ->> 'building')::boolean, false);
      reason := 'Jenkins: ' || reason;
    elsif results && array['BUILDING'] then
      target := 'IN_PROGRESS';
    elsif results <@ array['SUCCESS'] then
      target := 'COMPLETED';
    else
      return; -- some jobs never built yet
    end if;

    if step.status is distinct from target or (target = 'BLOCKED' and step.blocker_reason is distinct from reason) then
      update release_tasks
      set status = target, blocker_reason = case when target = 'BLOCKED' then reason else null end
      where id = step.id;
    end if;

  elsif job.purpose in ('LOAD_TEST', 'LONGEVITY', 'HIT')
        and p_build ->> 'result' in ('SUCCESS', 'UNSTABLE')
        and not coalesce((p_build ->> 'building')::boolean, false) then
    report_kind := job.purpose::text::report_type;
    url := coalesce(p_build ->> 'reportUrl', p_build ->> 'url');
    update reports
    set report_url = url
    where release_id = job.release_id and report_type = report_kind
      and (report_url is null or report_url = prev ->> 'reportUrl' or report_url = prev ->> 'url')
      and report_url is distinct from url;
  end if;
end;
$$;

-- Members may add activity entries in their projects, attributed to themselves.
create policy activity_log_insert on activity_log for insert
  with check (project_id in (select my_project_ids('MEMBER')) and user_id = app_user_id());
grant insert (release_id, project_id, user_id, action, description, metadata) on activity_log to release_tracker_app;

grant execute on function integration_secret(uuid), jenkins_jobs_to_sync(), jenkins_record_build(uuid, jsonb, text)
  to release_tracker_app;

-- Live updates when Jenkins data changes.
create trigger release_jenkins_jobs_notify after insert or update or delete on release_jenkins_jobs
  for each row execute function notify_release_change();
