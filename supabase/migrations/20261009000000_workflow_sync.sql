-- Phase 3: keep workflow steps, reports and approvals consistent in the DB,
-- whichever client path changes them.
--
--   reports.result  ──▶ review step status   (PASS/WARNING → COMPLETED, FAIL → BLOCKED)
--   approvals.status ─▶ APPROVAL step status (APPROVED → COMPLETED, REJECTED → BLOCKED)
--   escalation step completed ─▶ approvals.requested_at
--
-- Steps changed by these syncs are not logged twice: the source change
-- (report reviewed / approval recorded) is the activity entry.

-- ---------------------------------------------------------------------------
-- Task bookkeeping: completed_at and blocker_reason follow status changes
-- unless the client set them explicitly in the same update.
-- ---------------------------------------------------------------------------

create or replace function public.release_tasks_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'COMPLETED' and new.completed_at is null then
      new.completed_at := now();
    elsif new.status <> 'COMPLETED' and new.completed_at is not distinct from old.completed_at then
      new.completed_at := null;
    end if;

    if old.status = 'BLOCKED' and new.status <> 'BLOCKED'
       and new.blocker_reason is not distinct from old.blocker_reason then
      new.blocker_reason := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger release_tasks_bookkeeping before update on public.release_tasks
  for each row execute function public.release_tasks_before_update();

-- Escalation sent → approval is now requested.
create or replace function public.release_tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_type = 'RC_ESCALATION_EMAIL' and new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
    update public.approvals
    set requested_at = coalesce(requested_at, new.completed_at)
    where release_id = new.release_id;
  end if;
  return null;
end;
$$;

create trigger release_tasks_after_update after update on public.release_tasks
  for each row execute function public.release_tasks_after_update();

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create or replace function public.reports_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.result is distinct from old.result then
    if new.result <> 'NOT_REVIEWED' then
      new.status := 'COMPLETED';
      if new.reviewed_at is not distinct from old.reviewed_at then
        new.reviewed_at := now();
      end if;
      if new.reviewer_id is not distinct from old.reviewer_id then
        new.reviewer_id := coalesce(auth.uid(), new.reviewer_id);
      end if;
    else
      if new.status = 'COMPLETED' then
        new.status := 'IN_PROGRESS';
      end if;
      new.reviewed_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger reports_bookkeeping before update on public.reports
  for each row execute function public.reports_before_update();

create or replace function public.report_task_type(t public.report_type)
returns public.workflow_task_type
language sql
immutable
as $$
  select case t
    when 'LOAD_TEST' then 'LOAD_TEST_REVIEW'::public.workflow_task_type
    when 'LONGEVITY' then 'LONGEVITY_REVIEW'::public.workflow_task_type
    else 'HIT_REVIEW'::public.workflow_task_type
  end;
$$;

create or replace function public.reports_sync_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.task_status;
begin
  if new.status is not distinct from old.status and new.result is not distinct from old.result then
    return null;
  end if;

  target := case
    when new.status = 'SKIPPED' then 'SKIPPED'
    when new.result = 'FAIL' then 'BLOCKED'
    when new.result in ('PASS', 'WARNING') then 'COMPLETED'
    when new.status = 'IN_PROGRESS' then 'IN_PROGRESS'
    else 'NOT_STARTED'
  end;

  perform set_config('app.workflow_sync', 'on', true);
  update public.release_tasks
  set status = target,
      completed_at = case when target = 'COMPLETED' then new.reviewed_at else null end,
      blocker_reason = case
        when target = 'BLOCKED' then
          (case new.report_type when 'LOAD_TEST' then 'Load Test' when 'LONGEVITY' then 'Longevity' else 'HIT' end)
          || ' report failed'
        else null
      end
  where release_id = new.release_id
    and task_type = public.report_task_type(new.report_type)
    and status is distinct from target;
  perform set_config('app.workflow_sync', 'off', true);

  return null;
end;
$$;

create trigger reports_sync_task after update on public.reports
  for each row execute function public.reports_sync_task();

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

create or replace function public.approvals_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'PENDING' then
      new.approved_at := null;
      new.approved_by := null;
    else
      if new.approved_at is not distinct from old.approved_at then
        new.approved_at := now();
      end if;
      if new.approved_by is not distinct from old.approved_by then
        new.approved_by := coalesce(auth.uid(), new.approved_by);
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger approvals_bookkeeping before update on public.approvals
  for each row execute function public.approvals_before_update();

create or replace function public.approvals_sync_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.task_status;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  target := case new.status
    when 'APPROVED' then 'COMPLETED'
    when 'REJECTED' then 'BLOCKED'
    else 'IN_PROGRESS'
  end;

  perform set_config('app.workflow_sync', 'on', true);
  update public.release_tasks
  set status = target,
      completed_at = case when target = 'COMPLETED' then new.approved_at else null end,
      blocker_reason = case when target = 'BLOCKED' then 'Approval rejected' else null end
  where release_id = new.release_id
    and task_type = 'APPROVAL'
    and status is distinct from target;
  perform set_config('app.workflow_sync', 'off', true);

  return null;
end;
$$;

create trigger approvals_sync_task after update on public.approvals
  for each row execute function public.approvals_sync_task();

-- ---------------------------------------------------------------------------
-- Activity: skip step entries produced by the syncs above.
-- ---------------------------------------------------------------------------

create or replace function public.log_release_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  label text;
begin
  if tg_table_name = 'releases' then
    if tg_op = 'INSERT' then
      insert into public.activity_log (release_id, user_id, action, description, metadata)
      values (new.id, actor, 'release.created',
              format('created %s (%s)', new.name, new.version), '{}'::jsonb);
    else
      if new.planned_deployment_date is distinct from old.planned_deployment_date then
        insert into public.activity_log (release_id, user_id, action, description, metadata)
        values (new.id, actor, 'release.target_changed',
                format('moved target deployment to %s', to_char(new.planned_deployment_date, 'Mon DD')),
                jsonb_build_object('from', old.planned_deployment_date, 'to', new.planned_deployment_date));
      end if;
      if new.sprint_id is distinct from old.sprint_id then
        insert into public.activity_log (release_id, user_id, action, description, metadata)
        values (new.id, actor, 'release.sprint_changed',
                format('moved release to %s', (select s.name from public.sprints s where s.id = new.sprint_id)),
                jsonb_build_object('from', old.sprint_id, 'to', new.sprint_id));
      end if;
      if new.status_override is distinct from old.status_override then
        insert into public.activity_log (release_id, user_id, action, description, metadata)
        values (new.id, actor, 'release.status_overridden',
                case when new.status_override is null then 'cleared the status override'
                     else format('overrode status to %s', replace(new.status_override::text, '_', ' ')) end,
                jsonb_build_object('from', old.status_override, 'to', new.status_override,
                                   'reason', new.status_override_reason));
      end if;
    end if;

  elsif tg_table_name = 'release_tasks' then
    if new.status is distinct from old.status
       and coalesce(current_setting('app.workflow_sync', true), 'off') <> 'on' then
      label := case new.status
        when 'COMPLETED'   then 'completed %s'
        when 'IN_PROGRESS' then 'started %s'
        when 'BLOCKED'     then 'marked %s as blocked'
        when 'SKIPPED'     then 'skipped %s'
        else 'reset %s'
      end;
      insert into public.activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'task.status_changed', format(label, new.name),
              jsonb_build_object('task_id', new.id, 'task_type', new.task_type,
                                 'from', old.status, 'to', new.status,
                                 'blocker_reason', new.blocker_reason));
    end if;

  elsif tg_table_name = 'reports' then
    if new.result is distinct from old.result then
      label := case new.report_type
        when 'LOAD_TEST' then 'Load Test'
        when 'LONGEVITY' then 'Longevity'
        else 'HIT'
      end;
      insert into public.activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'report.result_changed',
              case when new.result = 'NOT_REVIEWED' then format('reset the %s report review', label)
                   else format('reviewed the %s report: %s', label, new.result) end,
              jsonb_build_object('report_id', new.id, 'report_type', new.report_type,
                                 'from', old.result, 'to', new.result));
    elsif new.status is distinct from old.status and new.status in ('SKIPPED', 'IN_PROGRESS') then
      label := case new.report_type
        when 'LOAD_TEST' then 'Load Test'
        when 'LONGEVITY' then 'Longevity'
        else 'HIT'
      end;
      insert into public.activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'report.status_changed',
              case when new.status = 'SKIPPED' then format('skipped the %s report', label)
                   else format('started the %s report review', label) end,
              jsonb_build_object('report_id', new.id, 'from', old.status, 'to', new.status));
    end if;

  elsif tg_table_name = 'approvals' then
    if new.status is distinct from old.status then
      insert into public.activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'approval.status_changed',
              case new.status
                when 'APPROVED' then 'recorded approval'
                when 'REJECTED' then 'recorded a rejection'
                else 'reset approval to pending'
              end,
              jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;

  return new;
end;
$$;

create index activity_log_user_id_idx on public.activity_log (user_id);
