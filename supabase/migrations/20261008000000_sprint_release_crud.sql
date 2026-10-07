-- Phase 2: sprint/release CRUD support.

-- At most one ACTIVE sprint, so "the current sprint" is never ambiguous.
create unique index sprints_single_active_idx on public.sprints (status)
  where status = 'ACTIVE';

-- Deletes. Sprints with releases cannot be deleted (releases.sprint_id is
-- ON DELETE RESTRICT); deleting a release cascades to its tasks, reports,
-- approval and activity.
create policy "sprints: delete" on public.sprints
  for delete to authenticated using (public.has_app_access());

create policy "releases: delete" on public.releases
  for delete to authenticated using (public.has_app_access());

-- Log sprint moves alongside the existing release activity.
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
    end if;

  elsif tg_table_name = 'release_tasks' then
    if new.status is distinct from old.status then
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
              format('reviewed the %s report: %s', label, new.result),
              jsonb_build_object('report_id', new.id, 'report_type', new.report_type,
                                 'from', old.result, 'to', new.result));
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
