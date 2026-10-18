-- An UNSTABLE Jenkins result (e.g. some tests flagged) doesn't block the
-- Automated jobs step: it counts as finished, like SUCCESS. FAILURE and
-- ABORTED still block. (UNSTABLE runs already filled their report link.)

create or replace function apply_automated_jobs_internal(p_release uuid) returns void
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

-- Releases blocked only because of an UNSTABLE run: re-apply the rule now.
select apply_automated_jobs_internal(release_id)
from release_tasks
where task_type = 'AUTOMATED_JOBS' and status = 'BLOCKED' and blocker_reason like 'Jenkins:%unstable%';
