-- Teams notifications: a project's Workflows webhook (TEAMS integration)
-- receives blocked steps, finished Jenkins jobs and a daily summary.
--
-- TEAMS integration: secret = the webhook URL (anyone with it can post, so
-- it's encrypted like a token), base_url = its origin, settings =
-- {"events": {"blocked": true, "jenkins": true, "daily": true},
--  "dailyTime": "09:00", "timezone": "Europe/Paris", "weekdaysOnly": true}.

alter table integrations drop constraint integrations_auth_matches_kind;
alter table integrations add constraint integrations_auth_matches_kind check (
  (kind = 'JIRA' and auth_type in ('JIRA_CLOUD', 'JIRA_SERVER'))
  or (kind = 'JENKINS' and auth_type = 'JENKINS')
  or (kind = 'GITHUB' and auth_type = 'GITHUB')
  or (kind = 'TEAMS' and auth_type = 'TEAMS')
);

-- Events waiting to be posted (and a short history of what was sent).
create table notification_outbox (
  id               bigint generated always as identity primary key,
  project_id       uuid not null references projects (id) on delete cascade,
  release_id       uuid references releases (id) on delete cascade,
  kind             text not null check (kind in ('blocked', 'jenkins', 'daily')),
  payload          jsonb not null,
  -- One daily summary per project and day.
  dedupe_key       text unique,
  created_at       timestamptz not null default now(),
  next_attempt_at  timestamptz not null default now(),
  attempts         integer not null default 0,
  sent_at          timestamptz,
  last_error       text
);
create index notification_outbox_pending_idx on notification_outbox (next_attempt_at) where sent_at is null;
-- Only the functions below touch it.
alter table notification_outbox enable row level security;

/** Whether the project posts this kind of event to Teams. */
create function teams_wants(p_project uuid, p_event text) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from integrations
    where project_id = p_project and kind = 'TEAMS'
      and coalesce((settings -> 'events' ->> p_event)::boolean, true)
  )
$$;

-- A step became blocked (by a person, a report, or Jenkins).
create function notify_step_blocked() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r releases;
  by_name text;
begin
  select * into r from releases where id = new.release_id;
  if not teams_wants(r.project_id, 'blocked') then return null; end if;
  select name into by_name from users where id = app_user_id();
  insert into notification_outbox (project_id, release_id, kind, payload)
  values (r.project_id, r.id, 'blocked', jsonb_build_object(
    'release', jsonb_build_object('id', r.id, 'name', r.name, 'version', r.version),
    'step', new.name, 'reason', new.blocker_reason, 'by', coalesce(by_name, 'Jenkins')));
  return null;
end;
$$;
create trigger release_tasks_notify_blocked after update on release_tasks
  for each row when (new.status = 'BLOCKED' and old.status is distinct from 'BLOCKED')
  execute function notify_step_blocked();

-- A Jenkins build finished (logged as activity by the Jenkins sync).
create function notify_jenkins_build() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r releases;
begin
  if new.release_id is null or not teams_wants(new.project_id, 'jenkins') then return null; end if;
  select * into r from releases where id = new.release_id;
  insert into notification_outbox (project_id, release_id, kind, payload)
  values (new.project_id, r.id, 'jenkins', jsonb_build_object(
    'release', jsonb_build_object('id', r.id, 'name', r.name, 'version', r.version),
    'description', new.description,
    'result', coalesce(new.metadata -> 'build' ->> 'result', new.metadata ->> 'result'),
    'url', new.metadata -> 'build' ->> 'url'));
  return null;
end;
$$;
create trigger activity_log_notify_jenkins after insert on activity_log
  for each row when (new.action = 'jenkins.build')
  execute function notify_jenkins_build();

-- --- For the server's notifier (no signed-in user) ----------------------------------------

-- Events due for delivery (a few seconds old, so related events arrive as one
-- card), with the project's webhook.
create function notifications_due(p_min_age interval default interval '5 seconds')
returns table (id bigint, project_id uuid, release_id uuid, kind text, payload jsonb, attempts integer,
               integration_id uuid, secret_encrypted text, ca_cert text)
language sql stable security definer set search_path = public
as $$
  select o.id, o.project_id, o.release_id, o.kind, o.payload, o.attempts, i.id, i.secret_encrypted, i.ca_cert
  from notification_outbox o
  join integrations i on i.project_id = o.project_id and i.kind = 'TEAMS'
  where o.sent_at is null and o.attempts < 6 and o.next_attempt_at <= now()
    and o.created_at <= now() - p_min_age
  order by o.created_at
  limit 200
$$;

-- Marks events sent, or failed (retried with back-off: 1, 2, 4, 8, 16 min).
create function notifications_mark(p_ids bigint[], p_error text default null) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_error is null then
    update notification_outbox set sent_at = now(), last_error = null where id = any(p_ids);
    update integrations i set last_error = null, last_checked_at = now()
    from notification_outbox o where o.id = any(p_ids) and i.project_id = o.project_id and i.kind = 'TEAMS';
  else
    update notification_outbox
    set attempts = attempts + 1, last_error = left(p_error, 1000),
        next_attempt_at = now() + interval '1 minute' * power(2, attempts)
    where id = any(p_ids);
    update integrations i set last_error = left('Teams: ' || p_error, 1000), last_checked_at = now()
    from notification_outbox o where o.id = any(p_ids) and i.project_id = o.project_id and i.kind = 'TEAMS';
  end if;
  -- Keep a month of history.
  delete from notification_outbox where sent_at < now() - interval '30 days';
end;
$$;

-- Projects that want a daily summary, with their settings.
create function daily_summary_projects()
returns table (project_id uuid, project_name text, settings jsonb)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, i.settings
  from integrations i join projects p on p.id = i.project_id
  where i.kind = 'TEAMS' and coalesce((i.settings -> 'events' ->> 'daily')::boolean, true)
$$;

-- What the dashboard's "Action required" list needs, for one project's open releases.
create function daily_summary_releases(p_project uuid) returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.name, 'version', r.version,
    'planned_deployment_date', r.planned_deployment_date, 'actual_deployment_date', r.actual_deployment_date,
    'status_override', r.status_override,
    'owner', case when o.id is null then null else jsonb_build_object('id', o.id, 'name', o.name) end,
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
                'task_type', t.task_type, 'status', t.status, 'planned_date', t.planned_date,
                'blocker_reason', t.blocker_reason, 'owner_id', t.owner_id) order by t.position)
              from release_tasks t where t.release_id = r.id), '[]'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('report_type', x.report_type, 'result', x.result))
                from reports x where x.release_id = r.id), '[]'),
    'code_check', (select to_jsonb(c) - 'release_id' from release_code_checks c where c.release_id = r.id)
  ) order by r.planned_deployment_date), '[]')
  from releases r left join users o on o.id = r.owner_id
  where r.project_id = p_project and r.actual_deployment_date is null
$$;

-- Queues today's summary once; false if it was already queued.
create function enqueue_daily_summary(p_project uuid, p_day text, p_payload jsonb) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into notification_outbox (project_id, kind, payload, dedupe_key, created_at)
  values (p_project, 'daily', p_payload, 'daily:' || p_project || ':' || p_day, now() - interval '5 seconds')
  on conflict (dedupe_key) do nothing;
  return found;
end;
$$;

revoke execute on function teams_wants(uuid, text) from public;
grant execute on function notifications_due(interval), notifications_mark(bigint[], text), daily_summary_projects(),
  daily_summary_releases(uuid), enqueue_daily_summary(uuid, text, jsonb) to release_tracker_app;
