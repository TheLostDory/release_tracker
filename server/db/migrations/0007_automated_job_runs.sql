-- Automated jobs step: the Jenkins runs of a release candidate (Load Test,
-- Longevity, HIT, plus any other automated job) are added by link, show their
-- live status, and drive the step and the report links.

alter table release_jenkins_builds add column purpose jenkins_job_purpose;
-- One run per report type; any number of other automated jobs.
create unique index release_jenkins_builds_report_slot on release_jenkins_builds (release_id, purpose)
  where purpose in ('LOAD_TEST', 'LONGEVITY', 'HIT');
grant insert (purpose) on release_jenkins_builds to release_tracker_app;

-- The "Automated jobs" step from everything Jenkins reports for the release:
-- jobs linked with purpose AUTOMATED (their latest build) and runs added to
-- the step (any purpose). Any failure → blocked (with the reason), anything
-- running → in progress, everything passed → completed.
-- Internal: called by the record functions below (not granted to the app role).
create function apply_automated_jobs_internal(p_release uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  results text[];
  target task_status;
  reason text;
  step release_tasks;
begin

  with runs as (
    select j.job_path as name, j.last_build ->> 'number' as number,
           coalesce((j.last_build ->> 'building')::boolean, false) as building, j.last_build ->> 'result' as result
    from release_jenkins_jobs j
    where j.release_id = p_release and j.purpose = 'AUTOMATED'
    union all
    select b.job_path, b.build_number::text,
           coalesce((b.status ->> 'building')::boolean, false), b.status ->> 'result'
    from release_jenkins_builds b
    where b.release_id = p_release and b.purpose is not null and b.status is not null
  )
  select array_agg(case when building then 'BUILDING' else coalesce(result, 'NONE') end),
         string_agg(format('%s #%s %s', name, number, lower(result)), ', ')
           filter (where not building and result in ('FAILURE', 'UNSTABLE', 'ABORTED'))
  into results, reason
  from runs;

  if results is null then return; end if;
  select * into step from release_tasks where release_id = p_release and task_type = 'AUTOMATED_JOBS';
  if step.id is null or step.status = 'SKIPPED' then return; end if;

  if results && array['FAILURE', 'UNSTABLE', 'ABORTED'] then
    target := 'BLOCKED';
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
end;
$$;
revoke execute on function apply_automated_jobs_internal(uuid) from public;

-- For the API after a member removes a run.
create function apply_automated_jobs(p_release uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_release not in (select my_release_ids('MEMBER')) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform apply_automated_jobs_internal(p_release);
end;
$$;
grant execute on function apply_automated_jobs(uuid) to release_tracker_app;

-- Same as before, with the step logic shared with the runs above.
create or replace function jenkins_record_build(p_job uuid, p_build jsonb, p_error text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  job release_jenkins_jobs;
  prev jsonb;
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
    perform apply_automated_jobs_internal(job.release_id);
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

-- Stores a run's latest status (anyone who can see the release may refresh
-- it). Runs added to the Automated jobs step also: log when they finish,
-- drive the step, and fill their report's link once passed.
drop function jenkins_followed_record(uuid, jsonb, text);
create function jenkins_followed_record(p_id uuid, p_status jsonb, p_error text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  run release_jenkins_builds;
  prev jsonb;
  url text;
begin
  select * into run from release_jenkins_builds where id = p_id;
  if run.id is null then return; end if;
  -- Signed-in users only for releases they can see (the poller has no user).
  if app_user_id() is not null and run.release_id not in (select my_release_ids('VIEWER')) then return; end if;
  prev := run.status;

  update release_jenkins_builds
  set status = coalesce(p_status, status), last_error = p_error, last_synced_at = now()
  where id = p_id;

  if p_status is null or run.purpose is null then return; end if;

  if (prev is null or coalesce((prev ->> 'building')::boolean, false))
     and not coalesce((p_status ->> 'building')::boolean, false) and p_status ->> 'result' is not null then
    insert into activity_log (release_id, user_id, action, description, metadata)
    values (run.release_id, null, 'jenkins.build',
            format('Jenkins: %s %s #%s %s',
                   case run.purpose when 'LOAD_TEST' then 'Load Test' when 'LONGEVITY' then 'Longevity' when 'HIT' then 'HIT' else 'job' end,
                   run.job_path, run.build_number, lower(p_status ->> 'result')),
            jsonb_build_object('followed_id', run.id, 'result', p_status ->> 'result'));
  end if;

  perform apply_automated_jobs_internal(run.release_id);

  if run.purpose in ('LOAD_TEST', 'LONGEVITY', 'HIT')
     and p_status ->> 'result' in ('SUCCESS', 'UNSTABLE')
     and not coalesce((p_status ->> 'building')::boolean, false) then
    url := coalesce(p_status ->> 'reportUrl', p_status ->> 'url');
    update reports
    set report_url = url
    where release_id = run.release_id and report_type = run.purpose::text::report_type
      and (report_url is null or report_url = prev ->> 'reportUrl' or report_url = prev ->> 'url')
      and report_url is distinct from url;
  end if;
end;
$$;
grant execute on function jenkins_followed_record(uuid, jsonb, text) to release_tracker_app;

-- Runs whose status may still change (anything running or queued in the
-- tree, or never read), on releases not deployed yet: for the poller.
create function jenkins_followed_to_sync()
returns table (id uuid, release_id uuid, job_path text, build_number integer,
               base_url text, username text, secret_encrypted text, ca_cert text)
language sql stable security definer set search_path = public
as $$
  select b.id, b.release_id, b.job_path, b.build_number, i.base_url, i.username, i.secret_encrypted, i.ca_cert
  from release_jenkins_builds b
  join releases r on r.id = b.release_id
  join integrations i on i.project_id = r.project_id and i.kind = 'JENKINS'
  where r.actual_deployment_date is null
    and (b.status is null or jsonb_path_exists(b.status, '$.** ? (@.building == true || @.queued == true)'))
$$;
grant execute on function jenkins_followed_to_sync() to release_tracker_app;
