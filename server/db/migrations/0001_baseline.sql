-- Release Tracker schema (Express + PostgreSQL).
--
-- Ported from the former Supabase migrations. Supabase pieces replaced:
--   auth.users / auth.uid()   → users table + app_user_id() (set per request)
--   anon / authenticated      → the restricted login role `release_tracker_app`
--   Realtime publication      → pg_notify('release_changes') triggers
--
-- Access model: the API sets `app.user_id` for every request transaction and
-- connects as `release_tracker_app`, which has NO bypass: row level security
-- below decides what each user can read and write. Credentials and sessions
-- are only reachable through security-definer functions.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type sprint_status as enum ('PLANNED', 'ACTIVE', 'COMPLETED');
create type task_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED');
create type workflow_task_type as enum (
  'RELEASE_IDENTIFIED', 'RC_CREATION', 'AUTOMATED_JOBS', 'LOAD_TEST_REVIEW', 'LONGEVITY_REVIEW',
  'HIT_REVIEW', 'RC_EMAIL', 'RTP_CREATION', 'RC_ESCALATION_EMAIL', 'APPROVAL', 'RELEASE_EMAIL', 'DEPLOYMENT'
);
create type report_type as enum ('LOAD_TEST', 'LONGEVITY', 'HIT');
create type report_result as enum ('PASS', 'FAIL', 'WARNING', 'NOT_REVIEWED');
create type release_status as enum ('ON_TRACK', 'AT_RISK', 'BLOCKED', 'WAITING_FOR_APPROVAL', 'RELEASED');
create type approval_status as enum ('PENDING', 'APPROVED', 'REJECTED');
-- Order matters: roles compare with >=.
create type project_role as enum ('VIEWER', 'MEMBER', 'ADMIN', 'OWNER');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The signed-in user for the current request (set by the API per transaction).
create function app_user_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function set_updated_at() returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end; $$;

-- User-entered URLs are rendered as links: only http(s).
create function is_http_url(value text) returns boolean
language sql immutable
as $$ select value is null or (value ~* '^https?://[^\s]+$' and length(value) <= 2048) $$;

-- ---------------------------------------------------------------------------
-- Users & sessions
-- ---------------------------------------------------------------------------

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  password_hash  text not null,
  avatar_url     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint users_email_lower check (email = lower(email)),
  constraint users_email_format check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint users_name_length check (length(trim(name)) between 1 and 80),
  constraint users_avatar_url_check check (is_http_url(avatar_url))
);
create trigger users_set_updated_at before update on users for each row execute function set_updated_at();

-- Opaque session tokens; only their SHA-256 is stored.
create table sessions (
  token_hash    text primary key,
  user_id       uuid not null references users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create table projects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  sprints_enabled  boolean not null default true,
  enabled_steps    workflow_task_type[] not null default enum_range(null::workflow_task_type),
  created_by       uuid references users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_name_length check (length(trim(name)) between 1 and 100),
  constraint projects_description_length check (coalesce(length(description), 0) <= 2000),
  constraint projects_required_steps check (
    'RELEASE_IDENTIFIED' = any (enabled_steps) and 'DEPLOYMENT' = any (enabled_steps)
  )
);
create trigger projects_set_updated_at before update on projects for each row execute function set_updated_at();

create table project_members (
  project_id  uuid not null references projects (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  role        project_role not null,
  invited_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members (user_id);

create table project_invitations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  role        project_role not null,
  email       text,
  token_hash  text unique,
  created_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  accepted_at timestamptz,
  use_count   integer not null default 0,
  constraint project_invitations_kind check ((email is null) <> (token_hash is null)),
  constraint project_invitations_role check (role <> 'OWNER')
);
create unique index project_invitations_pending_email_idx on project_invitations (project_id, email)
  where email is not null and accepted_at is null and revoked_at is null;
create index project_invitations_email_idx on project_invitations (email)
  where email is not null and accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Sprints & releases
-- ---------------------------------------------------------------------------

create table sprints (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      sprint_status not null default 'PLANNED',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sprints_dates_check check (end_date >= start_date),
  constraint sprints_name_per_project_unique unique (project_id, name),
  constraint sprints_id_project_unique unique (id, project_id)
);
create unique index sprints_single_active_idx on sprints (project_id) where status = 'ACTIVE';
create index sprints_project_idx on sprints (project_id, start_date desc);
create trigger sprints_set_updated_at before update on sprints for each row execute function set_updated_at();

create table releases (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references projects (id) on delete cascade,
  sprint_id                uuid,
  name                     text not null,
  version                  text not null,
  description              text,
  owner_id                 uuid references users (id) on delete set null,
  planned_deployment_date  date not null,
  actual_deployment_date   date,
  status_override          release_status,
  status_override_reason   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint releases_sprint_id_fkey foreign key (sprint_id, project_id) references sprints (id, project_id),
  constraint releases_name_not_blank check (length(trim(name)) > 0),
  constraint releases_version_not_blank check (length(trim(version)) > 0),
  constraint releases_text_length check (
    length(name) <= 100 and length(version) <= 50
    and coalesce(length(description), 0) <= 10000
    and coalesce(length(status_override_reason), 0) <= 2000
  )
);
create unique index releases_name_per_sprint_unique on releases (sprint_id, name) where sprint_id is not null;
create unique index releases_name_per_project_unique on releases (project_id, name) where sprint_id is null;
create index releases_project_idx on releases (project_id, planned_deployment_date);
create index releases_sprint_id_idx on releases (sprint_id);
create index releases_planned_deployment_date_idx on releases (planned_deployment_date);
create index releases_owner_id_idx on releases (owner_id);
create trigger releases_set_updated_at before update on releases for each row execute function set_updated_at();

create function releases_prevent_project_change() returns trigger
language plpgsql
as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'A release cannot be moved to another project'
      using errcode = 'check_violation', constraint = 'releases_project_immutable';
  end if;
  return new;
end;
$$;
create trigger releases_prevent_project_change before update on releases
  for each row execute function releases_prevent_project_change();

create table release_tasks (
  id              uuid primary key default gen_random_uuid(),
  release_id      uuid not null references releases (id) on delete cascade,
  task_type       workflow_task_type not null,
  name            text not null,
  position        smallint not null,
  status          task_status not null default 'NOT_STARTED',
  planned_date    date,
  completed_at    timestamptz,
  owner_id        uuid references users (id) on delete set null,
  notes           text,
  link            text,
  blocker_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint release_tasks_type_unique unique (release_id, task_type),
  constraint release_tasks_link_check check (is_http_url(link)),
  constraint release_tasks_text_length check (
    coalesce(length(notes), 0) <= 10000 and coalesce(length(blocker_reason), 0) <= 2000
  )
);
create index release_tasks_release_id_idx on release_tasks (release_id);
create index release_tasks_status_idx on release_tasks (status);
create index release_tasks_planned_date_idx on release_tasks (planned_date) where status not in ('COMPLETED', 'SKIPPED');
create index release_tasks_owner_id_idx on release_tasks (owner_id);
create trigger release_tasks_set_updated_at before update on release_tasks for each row execute function set_updated_at();

create table reports (
  id           uuid primary key default gen_random_uuid(),
  release_id   uuid not null references releases (id) on delete cascade,
  report_type  report_type not null,
  status       task_status not null default 'NOT_STARTED',
  result       report_result not null default 'NOT_REVIEWED',
  report_url   text,
  reviewer_id  uuid references users (id) on delete set null,
  reviewed_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint reports_type_unique unique (release_id, report_type),
  constraint reports_url_check check (is_http_url(report_url)),
  constraint reports_notes_length check (coalesce(length(notes), 0) <= 10000)
);
create index reports_release_id_idx on reports (release_id);
create trigger reports_set_updated_at before update on reports for each row execute function set_updated_at();

create table approvals (
  id            uuid primary key default gen_random_uuid(),
  release_id    uuid not null unique references releases (id) on delete cascade,
  status        approval_status not null default 'PENDING',
  requested_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references users (id) on delete set null,
  comments      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint approvals_comments_length check (coalesce(length(comments), 0) <= 10000)
);
create trigger approvals_set_updated_at before update on approvals for each row execute function set_updated_at();

create table activity_log (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  release_id   uuid references releases (id) on delete cascade,
  user_id      uuid references users (id) on delete set null,
  action       text not null,
  description  text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index activity_log_release_created_idx on activity_log (release_id, created_at desc);
create index activity_log_project_created_idx on activity_log (project_id, created_at desc);
create index activity_log_user_id_idx on activity_log (user_id);

-- ---------------------------------------------------------------------------
-- Access helpers. Security definer: they read membership without RLS
-- recursion. Policies use them inside `in (select …)` so Postgres evaluates
-- them once per query rather than per row.
-- ---------------------------------------------------------------------------

create function my_project_ids(min_role project_role default 'VIEWER') returns setof uuid
language sql stable security definer set search_path = public
as $$ select project_id from project_members where user_id = app_user_id() and role >= min_role $$;

create function my_release_ids(min_role project_role default 'VIEWER') returns setof uuid
language sql stable security definer set search_path = public
as $$
  select r.id from releases r join project_members m on m.project_id = r.project_id
  where m.user_id = app_user_id() and m.role >= min_role
$$;

create function my_colleague_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select app_user_id()
  union
  select other.user_id from project_members mine
  join project_members other on other.project_id = mine.project_id
  where mine.user_id = app_user_id()
$$;

create function project_role_of(p_project uuid) returns project_role
language sql stable security definer set search_path = public
as $$ select role from project_members where project_id = p_project and user_id = app_user_id() $$;

create function require_project_role(p_project uuid, min_role project_role) returns project_role
language plpgsql stable security definer set search_path = public
as $$
declare
  caller_role project_role := project_role_of(p_project);
begin
  if caller_role is null or caller_role < min_role then
    raise exception 'You need the % role in this project to do that', lower(min_role::text)
      using errcode = 'insufficient_privilege';
  end if;
  return caller_role;
end;
$$;

create function log_project_event(p_project uuid, p_action text, p_description text, p_metadata jsonb) returns void
language sql security definer set search_path = public
as $$
  insert into activity_log (project_id, release_id, user_id, action, description, metadata)
  values (p_project, null, app_user_id(), p_action, p_description, coalesce(p_metadata, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Workflow triggers (unchanged behaviour)
-- ---------------------------------------------------------------------------

-- New releases get the project's enabled steps, reports and approval.
create function initialize_release_workflow() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  steps workflow_task_type[];
begin
  select p.enabled_steps into steps from projects p where p.id = new.project_id;

  insert into release_tasks (release_id, task_type, name, position)
  select new.id, step.task_type, step.name, step.position
  from (values
    ('RELEASE_IDENTIFIED'::workflow_task_type, 'Release identified',  1),
    ('RC_CREATION',                            'RC creation',         2),
    ('AUTOMATED_JOBS',                         'Automated jobs',      3),
    ('LOAD_TEST_REVIEW',                       'Load Test review',    4),
    ('LONGEVITY_REVIEW',                       'Longevity review',    5),
    ('HIT_REVIEW',                             'HIT review',          6),
    ('RC_EMAIL',                               'RC email',            7),
    ('RTP_CREATION',                           'RTP creation',        8),
    ('RC_ESCALATION_EMAIL',                    'RC escalation email', 9),
    ('APPROVAL',                               'Approval',            10),
    ('RELEASE_EMAIL',                          'Release email',       11),
    ('DEPLOYMENT',                             'Deployment',          12)
  ) as step (task_type, name, position)
  where step.task_type = any (steps);

  insert into reports (release_id, report_type)
  select new.id, r.report_type
  from (values
    ('LOAD_TEST'::report_type, 'LOAD_TEST_REVIEW'::workflow_task_type),
    ('LONGEVITY', 'LONGEVITY_REVIEW'),
    ('HIT', 'HIT_REVIEW')
  ) as r (report_type, review_step)
  where r.review_step = any (steps);

  if 'APPROVAL' = any (steps) then
    insert into approvals (release_id) values (new.id);
  end if;
  return new;
end;
$$;
create trigger releases_initialize_workflow after insert on releases
  for each row execute function initialize_release_workflow();

create function release_tasks_before_update() returns trigger
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
create trigger release_tasks_bookkeeping before update on release_tasks
  for each row execute function release_tasks_before_update();

create function release_tasks_after_update() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.task_type = 'RC_ESCALATION_EMAIL' and new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
    update approvals set requested_at = coalesce(requested_at, new.completed_at) where release_id = new.release_id;
  end if;
  return null;
end;
$$;
create trigger release_tasks_after_update after update on release_tasks
  for each row execute function release_tasks_after_update();

create function reports_before_update() returns trigger
language plpgsql
as $$
begin
  if new.result is distinct from old.result then
    if new.result <> 'NOT_REVIEWED' then
      new.status := 'COMPLETED';
      if new.reviewed_at is not distinct from old.reviewed_at then new.reviewed_at := now(); end if;
      if new.reviewer_id is not distinct from old.reviewer_id then
        new.reviewer_id := coalesce(app_user_id(), new.reviewer_id);
      end if;
    else
      if new.status = 'COMPLETED' then new.status := 'IN_PROGRESS'; end if;
      new.reviewed_at := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger reports_bookkeeping before update on reports
  for each row execute function reports_before_update();

create function report_task_type(t report_type) returns workflow_task_type
language sql immutable
as $$
  select case t
    when 'LOAD_TEST' then 'LOAD_TEST_REVIEW'::workflow_task_type
    when 'LONGEVITY' then 'LONGEVITY_REVIEW'::workflow_task_type
    else 'HIT_REVIEW'::workflow_task_type
  end
$$;

create function report_label(t report_type) returns text
language sql immutable
as $$ select case t when 'LOAD_TEST' then 'Load Test' when 'LONGEVITY' then 'Longevity' else 'HIT' end $$;

-- report → review step (one direction)
create function reports_sync_task() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  target task_status;
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
  update release_tasks
  set status = target,
      completed_at = case when target = 'COMPLETED' then new.reviewed_at else null end,
      blocker_reason = case when target = 'BLOCKED' then report_label(new.report_type) || ' report failed' else null end
  where release_id = new.release_id and task_type = report_task_type(new.report_type) and status is distinct from target;
  perform set_config('app.workflow_sync', 'off', true);
  return null;
end;
$$;
create trigger reports_sync_task after update on reports
  for each row execute function reports_sync_task();

create function approvals_before_update() returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'PENDING' then
      new.approved_at := null;
      new.approved_by := null;
    else
      if new.approved_at is not distinct from old.approved_at then new.approved_at := now(); end if;
      if new.approved_by is not distinct from old.approved_by then
        new.approved_by := coalesce(app_user_id(), new.approved_by);
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger approvals_bookkeeping before update on approvals
  for each row execute function approvals_before_update();

create function approvals_sync_task() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  target task_status;
begin
  if new.status is not distinct from old.status then return null; end if;
  target := case new.status when 'APPROVED' then 'COMPLETED' when 'REJECTED' then 'BLOCKED' else 'IN_PROGRESS' end;
  perform set_config('app.workflow_sync', 'on', true);
  update release_tasks
  set status = target,
      completed_at = case when target = 'COMPLETED' then new.approved_at else null end,
      blocker_reason = case when target = 'BLOCKED' then 'Approval rejected' else null end
  where release_id = new.release_id and task_type = 'APPROVAL' and status is distinct from target;
  perform set_config('app.workflow_sync', 'off', true);
  return null;
end;
$$;
create trigger approvals_sync_task after update on approvals
  for each row execute function approvals_sync_task();

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------

create function activity_log_set_project() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.project_id is null and new.release_id is not null then
    select r.project_id into new.project_id from releases r where r.id = new.release_id;
  end if;
  return new;
end;
$$;
create trigger activity_log_set_project before insert on activity_log
  for each row execute function activity_log_set_project();

create function log_release_activity() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := app_user_id();
  label text;
begin
  if tg_table_name = 'releases' then
    if tg_op = 'INSERT' then
      insert into activity_log (release_id, user_id, action, description)
      values (new.id, actor, 'release.created', format('created %s (%s)', new.name, new.version));
    else
      if new.planned_deployment_date is distinct from old.planned_deployment_date then
        insert into activity_log (release_id, user_id, action, description, metadata)
        values (new.id, actor, 'release.target_changed',
                format('moved target deployment to %s', to_char(new.planned_deployment_date, 'Mon DD')),
                jsonb_build_object('from', old.planned_deployment_date, 'to', new.planned_deployment_date));
      end if;
      if new.sprint_id is distinct from old.sprint_id then
        insert into activity_log (release_id, user_id, action, description, metadata)
        values (new.id, actor, 'release.sprint_changed',
                case when new.sprint_id is null then 'removed the release from its sprint'
                     else format('moved release to %s', (select s.name from sprints s where s.id = new.sprint_id)) end,
                jsonb_build_object('from', old.sprint_id, 'to', new.sprint_id));
      end if;
      if new.status_override is distinct from old.status_override then
        insert into activity_log (release_id, user_id, action, description, metadata)
        values (new.id, actor, 'release.status_overridden',
                case when new.status_override is null then 'cleared the status override'
                     else format('overrode status to %s', replace(new.status_override::text, '_', ' ')) end,
                jsonb_build_object('from', old.status_override, 'to', new.status_override, 'reason', new.status_override_reason));
      end if;
    end if;

  elsif tg_table_name = 'release_tasks' then
    if new.status is distinct from old.status and coalesce(current_setting('app.workflow_sync', true), 'off') <> 'on' then
      label := case new.status
        when 'COMPLETED' then 'completed %s' when 'IN_PROGRESS' then 'started %s'
        when 'BLOCKED' then 'marked %s as blocked' when 'SKIPPED' then 'skipped %s' else 'reset %s'
      end;
      insert into activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'task.status_changed', format(label, new.name),
              jsonb_build_object('task_id', new.id, 'task_type', new.task_type, 'from', old.status, 'to', new.status,
                                 'blocker_reason', new.blocker_reason));
    end if;

  elsif tg_table_name = 'reports' then
    label := report_label(new.report_type);
    if new.result is distinct from old.result then
      insert into activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'report.result_changed',
              case when new.result = 'NOT_REVIEWED' then format('reset the %s report review', label)
                   else format('reviewed the %s report: %s', label, new.result) end,
              jsonb_build_object('report_id', new.id, 'report_type', new.report_type, 'from', old.result, 'to', new.result));
    elsif new.status is distinct from old.status and new.status in ('SKIPPED', 'IN_PROGRESS') then
      insert into activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'report.status_changed',
              case when new.status = 'SKIPPED' then format('skipped the %s report', label)
                   else format('started the %s report review', label) end,
              jsonb_build_object('report_id', new.id, 'from', old.status, 'to', new.status));
    end if;

  elsif tg_table_name = 'approvals' then
    if new.status is distinct from old.status then
      insert into activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'approval.status_changed',
              case new.status when 'APPROVED' then 'recorded approval' when 'REJECTED' then 'recorded a rejection'
                   else 'reset approval to pending' end,
              jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end;
$$;
create trigger releases_log_activity after insert or update on releases for each row execute function log_release_activity();
create trigger release_tasks_log_activity after update on release_tasks for each row execute function log_release_activity();
create trigger reports_log_activity after update on reports for each row execute function log_release_activity();
create trigger approvals_log_activity after update on approvals for each row execute function log_release_activity();

-- ---------------------------------------------------------------------------
-- Live updates: one notification per changed release (API → Server-Sent Events)
-- ---------------------------------------------------------------------------

create function notify_release_change() returns trigger
language plpgsql
as $$
declare
  rec record := case when tg_op = 'DELETE' then old else new end;
  rel uuid;
begin
  -- Plain IFs: PL/pgSQL resolves record fields per branch only when executed.
  if tg_table_name = 'releases' then
    rel := rec.id;
  else
    rel := rec.release_id;
  end if;
  perform pg_notify('release_changes', json_build_object('release_id', rel, 'table', tg_table_name)::text);
  return null;
end;
$$;
create trigger releases_notify after insert or update or delete on releases for each row execute function notify_release_change();
create trigger release_tasks_notify after update on release_tasks for each row execute function notify_release_change();
create trigger reports_notify after update on reports for each row execute function notify_release_change();
create trigger approvals_notify after update on approvals for each row execute function notify_release_change();

-- ---------------------------------------------------------------------------
-- Auth API (security definer: credentials and sessions are not otherwise
-- reachable by the app role)
-- ---------------------------------------------------------------------------

-- Creates the account and activates pending email invitations.
create function create_user(p_email text, p_name text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid;
  normalized text := lower(trim(p_email));
begin
  insert into users (email, name, password_hash) values (normalized, trim(p_name), p_password_hash)
  returning id into new_id;

  insert into project_members (project_id, user_id, role, invited_by)
  select i.project_id, new_id, i.role, i.created_by
  from project_invitations i
  where i.email = normalized and i.accepted_at is null and i.revoked_at is null
  on conflict do nothing;

  update project_invitations set accepted_at = now()
  where email = normalized and accepted_at is null and revoked_at is null;
  return new_id;
end;
$$;

create function login_lookup(p_email text) returns table (id uuid, password_hash text)
language sql stable security definer set search_path = public
as $$ select u.id, u.password_hash from users u where u.email = lower(trim(p_email)) $$;

create function create_session(p_user uuid, p_token_hash text, p_expires_at timestamptz) returns void
language sql security definer set search_path = public
as $$ insert into sessions (token_hash, user_id, expires_at) values (p_token_hash, p_user, p_expires_at) $$;

-- Returns the session's user, sliding the expiry; null if missing/expired.
create function resolve_session(p_token_hash text, p_extend_to timestamptz) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid;
begin
  update sessions set last_seen_at = now(), expires_at = greatest(expires_at, p_extend_to)
  where token_hash = p_token_hash and expires_at > now()
  returning user_id into uid;
  return uid;
end;
$$;

create function delete_session(p_token_hash text) returns void
language sql security definer set search_path = public
as $$ delete from sessions where token_hash = p_token_hash $$;

create function delete_expired_sessions() returns integer
language sql security definer set search_path = public
as $$ with d as (delete from sessions where expires_at < now() returning 1) select count(*)::int from d $$;

-- ---------------------------------------------------------------------------
-- Membership & invitation API
-- ---------------------------------------------------------------------------

create function create_project(p_name text, p_description text default null, p_sprints_enabled boolean default true) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid;
begin
  if app_user_id() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  insert into projects (name, description, sprints_enabled, created_by)
  values (trim(p_name), nullif(trim(p_description), ''), p_sprints_enabled, app_user_id())
  returning id into new_id;
  insert into project_members (project_id, user_id, role) values (new_id, app_user_id(), 'OWNER');
  perform log_project_event(new_id, 'project.created', format('created the project %s', trim(p_name)), null);
  return new_id;
end;
$$;

create function invite_by_email(p_project uuid, p_email text, p_role project_role) returns text
language plpgsql security definer set search_path = public
as $$
declare
  normalized text := lower(trim(p_email));
  target uuid;
begin
  perform require_project_role(p_project, 'ADMIN');
  if p_role = 'OWNER' then
    raise exception 'Invite as admin, then promote to owner' using errcode = 'check_violation';
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That is not a valid email address' using errcode = 'check_violation';
  end if;
  select u.id into target from users u where u.email = normalized;
  if target is not null then
    if exists (select 1 from project_members m where m.project_id = p_project and m.user_id = target) then
      raise exception 'That person is already a member of this project' using errcode = 'unique_violation';
    end if;
    insert into project_members (project_id, user_id, role, invited_by) values (p_project, target, p_role, app_user_id());
    perform log_project_event(p_project, 'member.added', format('added %s as %s', normalized, lower(p_role::text)),
      jsonb_build_object('user_id', target, 'role', p_role));
    return 'added';
  end if;
  insert into project_invitations (project_id, role, email, created_by)
  values (p_project, p_role, normalized, app_user_id())
  on conflict (project_id, email) where email is not null and accepted_at is null and revoked_at is null
  do update set role = excluded.role, created_by = excluded.created_by, created_at = now();
  perform log_project_event(p_project, 'invitation.created', format('invited %s as %s', normalized, lower(p_role::text)),
    jsonb_build_object('email', normalized, 'role', p_role));
  return 'invited';
end;
$$;

create function create_invite_link(p_project uuid, p_role project_role, p_expires_in_days int default 7) returns text
language plpgsql security definer set search_path = public
as $$
declare
  token text := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
begin
  perform require_project_role(p_project, 'ADMIN');
  if p_role = 'OWNER' then
    raise exception 'Links cannot grant the owner role' using errcode = 'check_violation';
  end if;
  if p_expires_in_days not between 1 and 90 then
    raise exception 'Links can be valid for 1 to 90 days' using errcode = 'check_violation';
  end if;
  insert into project_invitations (project_id, role, token_hash, created_by, expires_at)
  values (p_project, p_role, encode(digest(token, 'sha256'), 'hex'), app_user_id(), now() + make_interval(days => p_expires_in_days));
  perform log_project_event(p_project, 'invitation.link_created',
    format('created an invite link (%s, %s days)', lower(p_role::text), p_expires_in_days),
    jsonb_build_object('role', p_role, 'expires_in_days', p_expires_in_days));
  return token;
end;
$$;

create function revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  inv project_invitations;
begin
  select * into inv from project_invitations where id = p_invitation;
  if inv.id is null then raise exception 'Invitation not found' using errcode = 'no_data_found'; end if;
  perform require_project_role(inv.project_id, 'ADMIN');
  update project_invitations set revoked_at = now() where id = p_invitation and revoked_at is null;
  perform log_project_event(inv.project_id, 'invitation.revoked',
    case when inv.email is not null then format('revoked the invitation for %s', inv.email) else 'revoked an invite link' end,
    jsonb_build_object('invitation_id', inv.id));
end;
$$;

create function invite_link_info(p_token text)
returns table (project_id uuid, project_name text, role project_role, already_member boolean)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, i.role,
         exists (select 1 from project_members m where m.project_id = p.id and m.user_id = app_user_id())
  from project_invitations i join projects p on p.id = i.project_id
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
    and app_user_id() is not null
$$;

create function accept_invite_link(p_token text) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  inv project_invitations;
begin
  if app_user_id() is null then raise exception 'Sign in first' using errcode = 'insufficient_privilege'; end if;
  select * into inv from project_invitations
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null and (expires_at is null or expires_at > now());
  if inv.id is null then
    raise exception 'This invite link is invalid or has expired' using errcode = 'no_data_found';
  end if;
  insert into project_members (project_id, user_id, role, invited_by)
  values (inv.project_id, app_user_id(), inv.role, inv.created_by)
  on conflict (project_id, user_id) do nothing;
  if found then
    update project_invitations set use_count = use_count + 1 where id = inv.id;
    perform log_project_event(inv.project_id, 'member.joined', format('joined via invite link as %s', lower(inv.role::text)),
      jsonb_build_object('invitation_id', inv.id));
  end if;
  return inv.project_id;
end;
$$;

create function set_member_role(p_project uuid, p_user uuid, p_role project_role) returns void
language plpgsql security definer set search_path = public
as $$
declare
  actor_role project_role := require_project_role(p_project, 'ADMIN');
  target_role project_role;
begin
  select m.role into target_role from project_members m where m.project_id = p_project and m.user_id = p_user;
  if target_role is null then
    raise exception 'That person is not a member of this project' using errcode = 'no_data_found';
  end if;
  if (target_role = 'OWNER' or p_role = 'OWNER') and actor_role <> 'OWNER' then
    raise exception 'Only owners can change owner roles' using errcode = 'insufficient_privilege';
  end if;
  if target_role = 'OWNER' and p_role <> 'OWNER'
     and (select count(*) from project_members m where m.project_id = p_project and m.role = 'OWNER') = 1 then
    raise exception 'A project needs at least one owner' using errcode = 'check_violation';
  end if;
  update project_members set role = p_role where project_id = p_project and user_id = p_user;
  perform log_project_event(p_project, 'member.role_changed',
    format('changed %s from %s to %s', (select u.name from users u where u.id = p_user), lower(target_role::text), lower(p_role::text)),
    jsonb_build_object('user_id', p_user, 'from', target_role, 'to', p_role));
end;
$$;

create function remove_member(p_project uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  actor_role project_role := project_role_of(p_project);
  target_role project_role;
  leaving boolean := p_user = app_user_id();
begin
  if actor_role is null then
    raise exception 'You are not a member of this project' using errcode = 'insufficient_privilege';
  end if;
  select m.role into target_role from project_members m where m.project_id = p_project and m.user_id = p_user;
  if target_role is null then
    raise exception 'That person is not a member of this project' using errcode = 'no_data_found';
  end if;
  if not leaving then
    perform require_project_role(p_project, 'ADMIN');
    if target_role = 'OWNER' and actor_role <> 'OWNER' then
      raise exception 'Only owners can remove owners' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if target_role = 'OWNER'
     and (select count(*) from project_members m where m.project_id = p_project and m.role = 'OWNER') = 1 then
    raise exception 'A project needs at least one owner. Promote someone else first.' using errcode = 'check_violation';
  end if;
  delete from project_members where project_id = p_project and user_id = p_user;
  perform log_project_event(p_project, case when leaving then 'member.left' else 'member.removed' end,
    case when leaving then 'left the project' else format('removed %s', (select u.name from users u where u.id = p_user)) end,
    jsonb_build_object('user_id', p_user));
end;
$$;

-- Search across the caller's projects (RLS applies: security invoker).
create function search_releases(q text, max_results int default 20)
returns table (
  id uuid, name text, version text, project_id uuid, project_name text, sprint_name text,
  owner_name text, planned_deployment_date date, actual_deployment_date date
)
language sql stable
as $$
  with pattern as (
    select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  )
  select r.id, r.name, r.version, pr.id, pr.name, s.name, o.name, r.planned_deployment_date, r.actual_deployment_date
  from releases r
  join projects pr on pr.id = r.project_id
  left join sprints s on s.id = r.sprint_id
  left join users o on o.id = r.owner_id
  cross join pattern
  where length(trim(q)) > 0
    and (r.name ilike pattern.p or r.version ilike pattern.p or pr.name ilike pattern.p
         or s.name ilike pattern.p or o.name ilike pattern.p)
  order by (r.name ilike pattern.p or r.version ilike pattern.p) desc,
           r.actual_deployment_date is not null, r.planned_deployment_date desc
  limit least(greatest(max_results, 1), 50)
$$;

-- ---------------------------------------------------------------------------
-- Row level security (enforced for the app role)
-- ---------------------------------------------------------------------------

alter table users enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table project_invitations enable row level security;
alter table sprints enable row level security;
alter table releases enable row level security;
alter table release_tasks enable row level security;
alter table reports enable row level security;
alter table approvals enable row level security;
alter table activity_log enable row level security;

create policy users_read on users for select using (id in (select my_colleague_ids()));
create policy users_update_self on users for update using (id = app_user_id()) with check (id = app_user_id());

create policy projects_read on projects for select using (id in (select my_project_ids('VIEWER')));
create policy projects_update on projects for update
  using (id in (select my_project_ids('ADMIN'))) with check (id in (select my_project_ids('ADMIN')));
create policy projects_delete on projects for delete using (id in (select my_project_ids('OWNER')));

create policy project_members_read on project_members for select using (project_id in (select my_project_ids('VIEWER')));
create policy project_invitations_read on project_invitations for select using (project_id in (select my_project_ids('ADMIN')));

create policy sprints_read on sprints for select using (project_id in (select my_project_ids('VIEWER')));
create policy sprints_insert on sprints for insert with check (project_id in (select my_project_ids('MEMBER')));
create policy sprints_update on sprints for update
  using (project_id in (select my_project_ids('MEMBER'))) with check (project_id in (select my_project_ids('MEMBER')));
create policy sprints_delete on sprints for delete using (project_id in (select my_project_ids('ADMIN')));

create policy releases_read on releases for select using (project_id in (select my_project_ids('VIEWER')));
create policy releases_insert on releases for insert with check (project_id in (select my_project_ids('MEMBER')));
create policy releases_update on releases for update
  using (project_id in (select my_project_ids('MEMBER'))) with check (project_id in (select my_project_ids('MEMBER')));
create policy releases_delete on releases for delete using (project_id in (select my_project_ids('ADMIN')));

create policy release_tasks_read on release_tasks for select using (release_id in (select my_release_ids('VIEWER')));
create policy release_tasks_update on release_tasks for update
  using (release_id in (select my_release_ids('MEMBER'))) with check (release_id in (select my_release_ids('MEMBER')));

create policy reports_read on reports for select using (release_id in (select my_release_ids('VIEWER')));
create policy reports_update on reports for update
  using (release_id in (select my_release_ids('MEMBER'))) with check (release_id in (select my_release_ids('MEMBER')));

create policy approvals_read on approvals for select using (release_id in (select my_release_ids('VIEWER')));
create policy approvals_update on approvals for update
  using (release_id in (select my_release_ids('MEMBER'))) with check (release_id in (select my_release_ids('MEMBER')));

create policy activity_log_read on activity_log for select using (project_id in (select my_project_ids('VIEWER')));

-- ---------------------------------------------------------------------------
-- The app role: only what the API needs. No direct access to credentials,
-- sessions or membership writes.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select from pg_roles where rolname = 'release_tracker_app') then
    create role release_tracker_app login;
  end if;
end $$;

revoke all on all tables in schema public from public;
revoke all on all functions in schema public from public;
grant usage on schema public to release_tracker_app;

grant select (id, email, name, avatar_url, created_at, updated_at) on users to release_tracker_app;
grant update (name, avatar_url) on users to release_tracker_app;
grant select, update, delete on projects to release_tracker_app;
grant select on project_members, project_invitations to release_tracker_app;
grant select, insert, update, delete on sprints, releases to release_tracker_app;
grant select, update on release_tasks, reports, approvals to release_tracker_app;
grant select on activity_log to release_tracker_app;

grant execute on function
  app_user_id(), is_http_url(text), my_project_ids(project_role), my_release_ids(project_role), my_colleague_ids(),
  project_role_of(uuid), report_task_type(report_type), report_label(report_type),
  create_user(text, text, text), login_lookup(text), create_session(uuid, text, timestamptz),
  resolve_session(text, timestamptz), delete_session(text), delete_expired_sessions(),
  create_project(text, text, boolean), invite_by_email(uuid, text, project_role),
  create_invite_link(uuid, project_role, int), revoke_invitation(uuid), invite_link_info(text),
  accept_invite_link(text), set_member_role(uuid, uuid, project_role), remove_member(uuid, uuid),
  search_releases(text, int)
to release_tracker_app;
