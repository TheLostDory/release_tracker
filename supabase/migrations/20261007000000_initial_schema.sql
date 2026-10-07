-- Release Tracker: initial schema
--
-- Conventions
--   * UUID primary keys (gen_random_uuid()).
--   * Calendar days that carry no time-of-day (planned dates, sprint bounds,
--     target deployment) are `date`. Points in time (completion, review,
--     audit columns) are `timestamptz`, stored in UTC.
--   * The overall release status is NOT stored: it depends on "today" and is
--     computed in the client (src/lib/release-status.ts). `status_override`
--     exists for the explicit manual override case only.
--   * Authorization goes through public.has_app_access() so roles can be
--     introduced later by changing a single function.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.sprint_status as enum ('PLANNED', 'ACTIVE', 'COMPLETED');

create type public.task_status as enum (
  'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED'
);

create type public.workflow_task_type as enum (
  'RELEASE_IDENTIFIED',
  'RC_CREATION',
  'AUTOMATED_JOBS',
  'LOAD_TEST_REVIEW',
  'LONGEVITY_REVIEW',
  'HIT_REVIEW',
  'RC_EMAIL',
  'RTP_CREATION',
  'RC_ESCALATION_EMAIL',
  'APPROVAL',
  'RELEASE_EMAIL',
  'DEPLOYMENT'
);

create type public.report_type as enum ('LOAD_TEST', 'LONGEVITY', 'HIT');

create type public.report_result as enum ('PASS', 'FAIL', 'WARNING', 'NOT_REVIEWED');

create type public.release_status as enum (
  'ON_TRACK', 'AT_RISK', 'BLOCKED', 'WAITING_FOR_APPROVAL', 'RELEASED'
);

create type public.approval_status as enum ('PENDING', 'APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- User-entered URLs are rendered as links: only allow http(s) so values like
-- `javascript:` can never be stored.
create or replace function public.is_http_url(value text)
returns boolean
language sql
immutable
as $$
  select value is null or (value ~* '^https?://[^\s]+$' and length(value) <= 2048);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Single authorization hook. Today: any authenticated user has full access.
-- Later: check a role/membership table here.
create or replace function public.has_app_access()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  email       text not null unique,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  constraint profiles_avatar_url_check check (public.is_http_url(avatar_url))
);

create table public.sprints (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  start_date  date not null,
  end_date    date not null,
  status      public.sprint_status not null default 'PLANNED',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sprints_dates_check check (end_date >= start_date)
);

create table public.releases (
  id                       uuid primary key default gen_random_uuid(),
  sprint_id                uuid not null references public.sprints (id) on delete restrict,
  name                     text not null,
  version                  text not null,
  description              text,
  owner_id                 uuid references public.profiles (id) on delete set null,
  planned_deployment_date  date not null,
  actual_deployment_date   date,
  status_override          public.release_status,
  status_override_reason   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint releases_name_per_sprint_unique unique (sprint_id, name),
  constraint releases_name_not_blank check (length(trim(name)) > 0),
  constraint releases_version_not_blank check (length(trim(version)) > 0),
  constraint releases_text_length check (
    length(name) <= 100 and length(version) <= 50
    and coalesce(length(description), 0) <= 10000
    and coalesce(length(status_override_reason), 0) <= 2000
  )
);

create table public.release_tasks (
  id              uuid primary key default gen_random_uuid(),
  release_id      uuid not null references public.releases (id) on delete cascade,
  task_type       public.workflow_task_type not null,
  name            text not null,
  position        smallint not null,
  status          public.task_status not null default 'NOT_STARTED',
  planned_date    date,
  completed_at    timestamptz,
  owner_id        uuid references public.profiles (id) on delete set null,
  notes           text,
  link            text,
  blocker_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint release_tasks_type_unique unique (release_id, task_type),
  constraint release_tasks_link_check check (public.is_http_url(link)),
  constraint release_tasks_text_length check (
    coalesce(length(notes), 0) <= 10000 and coalesce(length(blocker_reason), 0) <= 2000
  )
);

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  release_id   uuid not null references public.releases (id) on delete cascade,
  report_type  public.report_type not null,
  status       public.task_status not null default 'NOT_STARTED',
  result       public.report_result not null default 'NOT_REVIEWED',
  report_url   text,
  reviewer_id  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint reports_type_unique unique (release_id, report_type),
  constraint reports_url_check check (public.is_http_url(report_url)),
  constraint reports_notes_length check (coalesce(length(notes), 0) <= 10000)
);

create table public.approvals (
  id            uuid primary key default gen_random_uuid(),
  release_id    uuid not null unique references public.releases (id) on delete cascade,
  status        public.approval_status not null default 'PENDING',
  requested_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references public.profiles (id) on delete set null,
  comments      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint approvals_comments_length check (coalesce(length(comments), 0) <= 10000)
);

create table public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  release_id   uuid references public.releases (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  action       text not null,
  description  text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index sprints_start_date_idx on public.sprints (start_date desc);

create index releases_sprint_id_idx on public.releases (sprint_id);
create index releases_status_override_idx on public.releases (status_override)
  where status_override is not null;
create index releases_planned_deployment_date_idx on public.releases (planned_deployment_date);
create index releases_owner_id_idx on public.releases (owner_id);

create index release_tasks_release_id_idx on public.release_tasks (release_id);
create index release_tasks_status_idx on public.release_tasks (status);
create index release_tasks_planned_date_idx on public.release_tasks (planned_date)
  where status not in ('COMPLETED', 'SKIPPED');
create index release_tasks_owner_id_idx on public.release_tasks (owner_id);

create index reports_release_id_idx on public.reports (release_id);

create index activity_log_release_created_idx on public.activity_log (release_id, created_at desc);
create index activity_log_created_idx on public.activity_log (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger sprints_set_updated_at before update on public.sprints
  for each row execute function public.set_updated_at();
create trigger releases_set_updated_at before update on public.releases
  for each row execute function public.set_updated_at();
create trigger release_tasks_set_updated_at before update on public.release_tasks
  for each row execute function public.set_updated_at();
create trigger reports_set_updated_at before update on public.reports
  for each row execute function public.set_updated_at();
create trigger approvals_set_updated_at before update on public.approvals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles: created automatically for every new auth user
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Release creation: generate the workflow tasks, report rows and approval
-- row atomically, so clients never have to create the 12 steps themselves.
-- Order/names must stay in sync with src/lib/workflow.ts.
-- ---------------------------------------------------------------------------

create or replace function public.initialize_release_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.release_tasks (release_id, task_type, name, position)
  select new.id, step.task_type, step.name, step.position
  from (values
    ('RELEASE_IDENTIFIED'::public.workflow_task_type,  'Release identified',  1),
    ('RC_CREATION',                                    'RC creation',         2),
    ('AUTOMATED_JOBS',                                 'Automated jobs',      3),
    ('LOAD_TEST_REVIEW',                               'Load Test review',    4),
    ('LONGEVITY_REVIEW',                               'Longevity review',    5),
    ('HIT_REVIEW',                                     'HIT review',          6),
    ('RC_EMAIL',                                       'RC email',            7),
    ('RTP_CREATION',                                   'RTP creation',        8),
    ('RC_ESCALATION_EMAIL',                            'RC escalation email', 9),
    ('APPROVAL',                                       'Approval',            10),
    ('RELEASE_EMAIL',                                  'Release email',       11),
    ('DEPLOYMENT',                                     'Deployment',          12)
  ) as step (task_type, name, position);

  insert into public.reports (release_id, report_type)
  values (new.id, 'LOAD_TEST'), (new.id, 'LONGEVITY'), (new.id, 'HIT');

  insert into public.approvals (release_id) values (new.id);

  return new;
end;
$$;

create trigger releases_initialize_workflow after insert on public.releases
  for each row execute function public.initialize_release_workflow();

-- ---------------------------------------------------------------------------
-- Activity log: written by triggers so every client path is audited the same
-- way. `user_id` is the acting user (auth.uid()); the UI renders the name.
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
    elsif new.planned_deployment_date is distinct from old.planned_deployment_date then
      insert into public.activity_log (release_id, user_id, action, description, metadata)
      values (new.id, actor, 'release.target_changed',
              format('moved target deployment to %s', to_char(new.planned_deployment_date, 'Mon DD')),
              jsonb_build_object('from', old.planned_deployment_date, 'to', new.planned_deployment_date));
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

create trigger releases_log_activity after insert or update on public.releases
  for each row execute function public.log_release_activity();
create trigger release_tasks_log_activity after update on public.release_tasks
  for each row execute function public.log_release_activity();
create trigger reports_log_activity after update on public.reports
  for each row execute function public.log_release_activity();
create trigger approvals_log_activity after update on public.approvals
  for each row execute function public.log_release_activity();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.sprints       enable row level security;
alter table public.releases      enable row level security;
alter table public.release_tasks enable row level security;
alter table public.reports       enable row level security;
alter table public.approvals     enable row level security;
alter table public.activity_log  enable row level security;

create policy "profiles: read" on public.profiles
  for select to authenticated using (public.has_app_access());
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "sprints: read" on public.sprints
  for select to authenticated using (public.has_app_access());
create policy "sprints: insert" on public.sprints
  for insert to authenticated with check (public.has_app_access());
create policy "sprints: update" on public.sprints
  for update to authenticated using (public.has_app_access()) with check (public.has_app_access());

create policy "releases: read" on public.releases
  for select to authenticated using (public.has_app_access());
create policy "releases: insert" on public.releases
  for insert to authenticated with check (public.has_app_access());
create policy "releases: update" on public.releases
  for update to authenticated using (public.has_app_access()) with check (public.has_app_access());

-- Tasks, reports and approvals are created by trigger; clients only read/update.
create policy "release_tasks: read" on public.release_tasks
  for select to authenticated using (public.has_app_access());
create policy "release_tasks: update" on public.release_tasks
  for update to authenticated using (public.has_app_access()) with check (public.has_app_access());

create policy "reports: read" on public.reports
  for select to authenticated using (public.has_app_access());
create policy "reports: update" on public.reports
  for update to authenticated using (public.has_app_access()) with check (public.has_app_access());

create policy "approvals: read" on public.approvals
  for select to authenticated using (public.has_app_access());
create policy "approvals: update" on public.approvals
  for update to authenticated using (public.has_app_access()) with check (public.has_app_access());

-- Activity is append-only and written by triggers (security definer).
create policy "activity_log: read" on public.activity_log
  for select to authenticated using (public.has_app_access());
