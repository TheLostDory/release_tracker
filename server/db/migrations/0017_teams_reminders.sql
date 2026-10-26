-- Teams reminders: steps due on the next working day (each morning) and
-- "approval needed" when approval is requested.

-- Open steps of open releases planned between two days, with their owners.
create function due_soon_steps(p_project uuid, p_from date, p_to date)
returns table (release_id uuid, release_name text, version text, step text, owner text, due date)
language sql stable security definer set search_path = public
as $$
  select r.id, r.name, r.version, t.name, u.name, t.planned_date
  from release_tasks t
  join releases r on r.id = t.release_id
  left join users u on u.id = t.owner_id
  where r.project_id = p_project and r.actual_deployment_date is null
    and t.status not in ('COMPLETED', 'SKIPPED') and t.planned_date between p_from and p_to
  order by r.planned_deployment_date, t.position
$$;

-- Projects that want reminders, with their Teams settings.
create function due_soon_projects()
returns table (project_id uuid, settings jsonb)
language sql stable security definer set search_path = public
as $$
  select i.project_id, i.settings from integrations i
  where i.kind = 'TEAMS' and coalesce((i.settings -> 'events' ->> 'dueSoon')::boolean, true)
$$;

-- Queues one notification once (by key); false if it was already queued.
create function enqueue_reminder(p_project uuid, p_release uuid, p_payload jsonb, p_key text) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into notification_outbox (project_id, release_id, kind, payload, dedupe_key, created_at)
  values (p_project, p_release, 'due_soon', p_payload, p_key, now() - interval '5 seconds')
  on conflict (dedupe_key) do nothing;
  return found;
end;
$$;

-- Approval requested → "approval needed" card.
create function notify_approval_requested() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r releases;
  due date;
  open_items text[];
begin
  select * into r from releases where id = new.release_id;
  if r.actual_deployment_date is not null or not teams_wants(r.project_id, 'approval') then return null; end if;
  select planned_date into due from release_tasks where release_id = r.id and task_type = 'APPROVAL';
  select coalesce(array_agg(t.name || case when t.status = 'BLOCKED' then ' (blocked)' else ' (overdue)' end order by t.position), '{}')
  into open_items
  from release_tasks t
  where t.release_id = r.id and t.task_type <> 'APPROVAL' and t.status not in ('COMPLETED', 'SKIPPED')
    and (t.status = 'BLOCKED' or t.planned_date < current_date);
  insert into notification_outbox (project_id, release_id, kind, payload)
  values (r.project_id, r.id, 'approval', jsonb_build_object(
    'release', jsonb_build_object('id', r.id, 'name', r.name, 'version', r.version),
    'due', due, 'target', r.planned_deployment_date, 'openItems', to_jsonb(open_items)));
  return null;
end;
$$;
create trigger approvals_notify_requested after update on approvals
  for each row when (new.requested_at is not null and old.requested_at is null and new.status = 'PENDING')
  execute function notify_approval_requested();

grant execute on function due_soon_steps(uuid, date, date), due_soon_projects(), enqueue_reminder(uuid, uuid, jsonb, text) to release_tracker_app;
