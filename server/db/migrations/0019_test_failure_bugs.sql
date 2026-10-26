-- Automation: when a HIT or Load Test run finishes, read the failed test
-- cases from its HTML report and find the Jira bugs / field bugs linked to
-- them. One analysis per run (re-done when asked).

create table release_test_analyses (
  run_id       uuid primary key references release_jenkins_builds (id) on delete cascade,
  release_id   uuid not null references releases (id) on delete cascade,
  state        text not null default 'pending' check (state in ('pending', 'done', 'failed')),
  -- {"reportUrl", "failedTests": [{"name", "bugs": [{key, summary, type, status, statusCategory, url, via}]}]}
  result       jsonb,
  error        text,
  attempts     integer not null default 0,
  requested_at timestamptz not null default now(),
  analyzed_at  timestamptz
);
create index release_test_analyses_release_idx on release_test_analyses (release_id);

alter table release_test_analyses enable row level security;
create policy test_analyses_read on release_test_analyses for select using (release_id in (select my_release_ids('VIEWER')));
grant select on release_test_analyses to release_tracker_app;

-- Which run purposes are analysed (projects.automation -> testFailures).
create function test_analysis_wanted(p_project uuid, p_purpose jenkins_job_purpose) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((p.automation -> 'testFailures' ->> 'enabled')::boolean, true)
         and p_purpose::text in (select jsonb_array_elements_text(coalesce(p.automation -> 'testFailures' -> 'purposes', '["HIT", "LOAD_TEST"]'::jsonb)))
  from projects p where p.id = p_project
$$;

-- A run finished → analysis queued.
create function queue_test_analysis() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  project uuid;
begin
  if new.purpose is null or new.status is null or coalesce((new.status ->> 'building')::boolean, false)
     or new.status ->> 'result' is null then
    return null;
  end if;
  -- Only on the change to finished (or a different build).
  if tg_op = 'UPDATE' and old.status is not null and not coalesce((old.status ->> 'building')::boolean, false)
     and old.status ->> 'result' is not null and old.build_number = new.build_number then
    return null;
  end if;
  select r.project_id into project from releases r where r.id = new.release_id;
  if not test_analysis_wanted(project, new.purpose) then return null; end if;
  insert into release_test_analyses (run_id, release_id) values (new.id, new.release_id)
  on conflict (run_id) do update set state = 'pending', error = null, attempts = 0, requested_at = now();
  return null;
end;
$$;
create trigger release_jenkins_builds_queue_analysis after insert or update of status on release_jenkins_builds
  for each row execute function queue_test_analysis();

-- "Check again" (members).
create function request_test_analysis(p_run uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  run release_jenkins_builds;
begin
  select * into run from release_jenkins_builds where id = p_run;
  if run.id is null or run.release_id not in (select my_release_ids('MEMBER')) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into release_test_analyses (run_id, release_id) values (run.id, run.release_id)
  on conflict (run_id) do update set state = 'pending', error = null, attempts = 0, requested_at = now();
end;
$$;

-- --- For the server's worker ----------------------------------------------------------------

create function test_analyses_due()
returns table (run_id uuid, release_id uuid, project_id uuid, purpose jenkins_job_purpose, job_path text, build_number integer,
               status jsonb, attempts integer, automation jsonb,
               jenkins_base_url text, jenkins_username text, jenkins_secret text, jenkins_ca text,
               jira_id uuid, jira_base_url text, jira_auth integration_auth, jira_username text, jira_secret text, jira_ca text, jira_settings jsonb)
language sql stable security definer set search_path = public
as $$
  select a.run_id, a.release_id, r.project_id, b.purpose, b.job_path, b.build_number, b.status, a.attempts, p.automation,
         jk.base_url, jk.username, jk.secret_encrypted, jk.ca_cert,
         ji.id, ji.base_url, ji.auth_type, ji.username, ji.secret_encrypted, ji.ca_cert, ji.settings
  from release_test_analyses a
  join release_jenkins_builds b on b.id = a.run_id
  join releases r on r.id = a.release_id
  join projects p on p.id = r.project_id
  join integrations jk on jk.project_id = r.project_id and jk.kind = 'JENKINS'
  left join integrations ji on ji.project_id = r.project_id and ji.kind = 'JIRA'
  where a.state = 'pending' and a.attempts < 3
  order by a.requested_at
  limit 20
$$;

create function test_analysis_save(p_run uuid, p_state text, p_result jsonb, p_error text) returns void
language sql security definer set search_path = public
as $$
  update release_test_analyses
  set state = p_state, result = coalesce(p_result, result), error = p_error,
      attempts = attempts + case when p_state = 'pending' then 1 else 0 end,
      analyzed_at = case when p_state = 'pending' then analyzed_at else now() end
  where run_id = p_run
$$;

grant execute on function request_test_analysis(uuid), test_analyses_due(), test_analysis_save(uuid, text, jsonb, text) to release_tracker_app;
