-- A parent Jenkins job that starts the Load Test, Longevity and HIT jobs:
-- the runs it starts fill the Automated jobs step's slots by themselves.

alter table release_jenkins_builds
  add column parent_run_id uuid references release_jenkins_builds (id) on delete set null;
grant insert (parent_run_id) on release_jenkins_builds to release_tracker_app;

-- For a run that may have started others: whether it's a parent (an "other
-- job" of the Automated jobs step) and its project's automation settings.
-- Also for the background sync, which has no signed-in user.
create function parent_run_info(p_run uuid, out is_parent boolean, out automation jsonb)
language plpgsql stable security definer set search_path = public
as $$
declare
  run release_jenkins_builds;
begin
  is_parent := false;
  automation := '{}'::jsonb;
  select * into run from release_jenkins_builds where id = p_run;
  if run.id is null then return; end if;
  if app_user_id() is not null and run.release_id not in (select my_release_ids('VIEWER')) then return; end if;
  is_parent := run.purpose = 'AUTOMATED';
  select coalesce(p.automation, '{}'::jsonb) into automation from releases r join projects p on p.id = r.project_id where r.id = run.release_id;
end;
$$;

-- Puts a run started by a parent run into its slot (Load Test / Longevity /
-- HIT). Replaces what's there unless that is newer: a later build of the
-- same job, or a child of a newer parent run. Returns the slot's run id when
-- it changed, null otherwise.
create function attach_child_run(p_parent uuid, p_purpose jenkins_job_purpose, p_job_path text, p_number integer) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  parent release_jenkins_builds;
  current release_jenkins_builds;
  current_parent release_jenkins_builds;
  run_id uuid;
begin
  select * into parent from release_jenkins_builds where id = p_parent;
  if parent.id is null or parent.purpose <> 'AUTOMATED' or p_purpose not in ('LOAD_TEST', 'LONGEVITY', 'HIT') then return null; end if;
  if app_user_id() is not null and parent.release_id not in (select my_release_ids('VIEWER')) then return null; end if;

  select * into current from release_jenkins_builds where release_id = parent.release_id and purpose = p_purpose;
  if current.id is not null then
    if current.job_path = p_job_path and current.build_number = p_number then return null; end if; -- already there
    if current.job_path = p_job_path and current.build_number > p_number then return null; end if; -- a later build is there
    if current.parent_run_id is not null and current.parent_run_id <> p_parent then
      select * into current_parent from release_jenkins_builds where id = current.parent_run_id;
      if current_parent.id is not null and current_parent.created_at > parent.created_at then return null; end if; -- newer parent's child
    end if;
    -- The report link the replaced run filled belongs to it.
    update reports set report_url = null
    where release_id = parent.release_id and report_type = p_purpose::text::report_type
      and report_url in (coalesce(current.status ->> 'reportUrl', ''), coalesce(current.status ->> 'url', ''));
    delete from release_jenkins_builds where id = current.id;
  end if;

  insert into release_jenkins_builds (release_id, job_path, build_number, purpose, parent_run_id, created_by)
  values (parent.release_id, p_job_path, p_number, p_purpose, p_parent, parent.created_by)
  on conflict (release_id, job_path, build_number) do update set purpose = excluded.purpose, parent_run_id = excluded.parent_run_id
  returning id into run_id;
  return run_id;
end;
$$;
grant execute on function parent_run_info(uuid), attach_child_run(uuid, jenkins_job_purpose, text, integer) to release_tracker_app;

-- "Start jobs" skips jobs that another job starts.
create or replace function request_jenkins_starts_internal(p_release uuid, p_user uuid) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  r releases;
  job jsonb;
  params jsonb;
  n integer := 0;
begin
  select * into r from releases where id = p_release;
  if r.id is null then return 0; end if;
  for job in select jsonb_array_elements(coalesce(p.automation -> 'jenkins' -> 'jobs', '[]'::jsonb)) from projects p where p.id = r.project_id
  loop
    if coalesce((job ->> 'startedByParent')::boolean, false) then continue; end if;
    if exists (select 1 from release_jenkins_starts s
               where s.release_id = p_release and s.job_path = job ->> 'jobPath' and s.state in ('to_start', 'queued')) then
      continue;
    end if;
    select coalesce(jsonb_object_agg(key, replace(replace(value, '{{version}}', r.version), '{{name}}', r.name)), '{}'::jsonb)
    into params from jsonb_each_text(coalesce(job -> 'parameters', '{}'::jsonb));
    insert into release_jenkins_starts (release_id, purpose, job_path, parameters, requested_by)
    values (p_release, (job ->> 'purpose')::jenkins_job_purpose, job ->> 'jobPath', params, p_user);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Fix: deciding the Automated jobs step raced when several runs were recorded
-- at once (each saw the others' old state). Serialized per release.
create or replace function apply_automated_jobs_internal(p_release uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  results text[];
  target task_status;
  reason text;
  step release_tasks;
begin
  -- One at a time per release: runs are recorded in parallel (the background
  -- check), and the last one to decide must see every run's final state.
  perform pg_advisory_xact_lock(hashtext('automated_jobs:' || p_release::text));
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
           filter (where not building and result in ('FAILURE', 'ABORTED'))
  into results, reason
  from runs;

  if results is null then return; end if;
  select * into step from release_tasks where release_id = p_release and task_type = 'AUTOMATED_JOBS';
  if step.id is null or step.status = 'SKIPPED' then return; end if;

  if results && array['FAILURE', 'ABORTED'] then
    target := 'BLOCKED';
    reason := 'Jenkins: ' || reason;
  elsif results && array['BUILDING'] then
    target := 'IN_PROGRESS';
  elsif results <@ array['SUCCESS', 'UNSTABLE'] then
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
