-- Projects, membership roles, invitations and per-project workflow settings.
--
-- Access model (replaces "any authenticated user can do everything"):
--   VIEWER  read the project
--   MEMBER  + create/edit sprints, releases, steps, reports, approvals
--   ADMIN   + project settings, invite/remove members, delete sprints/releases
--   OWNER   + delete the project, manage owners
-- Enum order matters: roles compare with >=.
--
-- Membership and invitation writes only go through the security-definer
-- functions at the bottom, which enforce the role rules in one place.

create type public.project_role as enum ('VIEWER', 'MEMBER', 'ADMIN', 'OWNER');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  sprints_enabled  boolean not null default true,
  -- Steps generated for releases created in this project. Report types and
  -- "approval required" are derived from it (review steps / APPROVAL).
  enabled_steps    public.workflow_task_type[] not null
                   default enum_range(null::public.workflow_task_type),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_name_length check (length(trim(name)) between 1 and 100),
  constraint projects_description_length check (coalesce(length(description), 0) <= 2000),
  constraint projects_required_steps check (
    'RELEASE_IDENTIFIED' = any (enabled_steps) and 'DEPLOYMENT' = any (enabled_steps)
  )
);

create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.project_role not null,
  invited_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.project_invitations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  role        public.project_role not null,
  -- Exactly one of: an email invite, or a shareable link (stored as a hash).
  email       text,
  token_hash  text unique,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  accepted_at timestamptz,
  use_count   integer not null default 0,
  constraint project_invitations_kind check ((email is null) <> (token_hash is null)),
  -- Owners are promoted after joining, never invited directly.
  constraint project_invitations_role check (role <> 'OWNER')
);
create unique index project_invitations_pending_email_idx
  on public.project_invitations (project_id, email)
  where email is not null and accepted_at is null and revoked_at is null;
create index project_invitations_email_idx on public.project_invitations (email)
  where email is not null and accepted_at is null and revoked_at is null;

create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Move existing data into a first project (only if there is any).
-- Everyone who had access before becomes an owner: nobody loses access.
-- ---------------------------------------------------------------------------

alter table public.sprints add column project_id uuid references public.projects (id) on delete cascade;
alter table public.releases add column project_id uuid references public.projects (id) on delete cascade;
alter table public.activity_log add column project_id uuid references public.projects (id) on delete cascade;

do $$
declare
  default_project uuid;
begin
  if exists (select 1 from public.sprints) or exists (select 1 from public.releases) then
    insert into public.projects (name, description)
    values ('Release Tracker', 'Releases tracked before projects were introduced.')
    returning id into default_project;

    insert into public.project_members (project_id, user_id, role)
    select default_project, p.id, 'OWNER' from public.profiles p;

    update public.sprints set project_id = default_project;
    update public.releases set project_id = default_project;
    update public.activity_log set project_id = default_project;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sprints: scoped to a project
-- ---------------------------------------------------------------------------

alter table public.sprints alter column project_id set not null;
alter table public.sprints drop constraint sprints_name_key;
alter table public.sprints add constraint sprints_name_per_project_unique unique (project_id, name);
-- Target for the releases → sprints composite FK below.
alter table public.sprints add constraint sprints_id_project_unique unique (id, project_id);
drop index public.sprints_single_active_idx;
create unique index sprints_single_active_idx on public.sprints (project_id) where status = 'ACTIVE';
create index sprints_project_idx on public.sprints (project_id, start_date desc);

-- ---------------------------------------------------------------------------
-- Releases: belong to a project; the sprint is optional but must be in the
-- same project (composite FK; NO ACTION so deleting a project can cascade).
-- ---------------------------------------------------------------------------

alter table public.releases alter column project_id set not null;
alter table public.releases alter column sprint_id drop not null;
alter table public.releases drop constraint releases_sprint_id_fkey;
alter table public.releases add constraint releases_sprint_id_fkey
  foreign key (sprint_id, project_id) references public.sprints (id, project_id);
alter table public.releases drop constraint releases_name_per_sprint_unique;
create unique index releases_name_per_sprint_unique on public.releases (sprint_id, name)
  where sprint_id is not null;
create unique index releases_name_per_project_unique on public.releases (project_id, name)
  where sprint_id is null;
create index releases_project_idx on public.releases (project_id, planned_deployment_date);

create or replace function public.releases_prevent_project_change()
returns trigger
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

create trigger releases_prevent_project_change before update on public.releases
  for each row execute function public.releases_prevent_project_change();

-- ---------------------------------------------------------------------------
-- Activity: always attributed to a project (release events or project events)
-- ---------------------------------------------------------------------------

create or replace function public.activity_log_set_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is null and new.release_id is not null then
    select r.project_id into new.project_id from public.releases r where r.id = new.release_id;
  end if;
  return new;
end;
$$;

create trigger activity_log_set_project before insert on public.activity_log
  for each row execute function public.activity_log_set_project();

alter table public.activity_log alter column project_id set not null;
create index activity_log_project_created_idx on public.activity_log (project_id, created_at desc);

-- Sprint removal message (sprint is now optional).
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
                case when new.sprint_id is null then 'removed the release from its sprint'
                     else format('moved release to %s', (select s.name from public.sprints s where s.id = new.sprint_id)) end,
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
    label := case new.report_type when 'LOAD_TEST' then 'Load Test' when 'LONGEVITY' then 'Longevity' else 'HIT' end;
    if new.result is distinct from old.result then
      insert into public.activity_log (release_id, user_id, action, description, metadata)
      values (new.release_id, actor, 'report.result_changed',
              case when new.result = 'NOT_REVIEWED' then format('reset the %s report review', label)
                   else format('reviewed the %s report: %s', label, new.result) end,
              jsonb_build_object('report_id', new.id, 'report_type', new.report_type,
                                 'from', old.result, 'to', new.result));
    elsif new.status is distinct from old.status and new.status in ('SKIPPED', 'IN_PROGRESS') then
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

-- ---------------------------------------------------------------------------
-- Release creation follows the project's workflow settings.
-- ---------------------------------------------------------------------------

create or replace function public.initialize_release_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  steps public.workflow_task_type[];
begin
  select p.enabled_steps into steps from public.projects p where p.id = new.project_id;

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
  ) as step (task_type, name, position)
  where step.task_type = any (steps);

  insert into public.reports (release_id, report_type)
  select new.id, r.report_type
  from (values
    ('LOAD_TEST'::public.report_type, 'LOAD_TEST_REVIEW'::public.workflow_task_type),
    ('LONGEVITY', 'LONGEVITY_REVIEW'),
    ('HIT', 'HIT_REVIEW')
  ) as r (report_type, review_step)
  where r.review_step = any (steps);

  if 'APPROVAL' = any (steps) then
    insert into public.approvals (release_id) values (new.id);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access helpers (security definer: they read membership without RLS
-- recursion). Policies call the set-returning ones inside `in (select …)`,
-- which Postgres evaluates once per query, not once per row.
-- ---------------------------------------------------------------------------

create or replace function public.my_project_ids(min_role public.project_role default 'VIEWER')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.project_id from public.project_members m
  where m.user_id = auth.uid() and m.role >= min_role;
$$;

create or replace function public.my_release_ids(min_role public.project_role default 'VIEWER')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.releases r
  join public.project_members m on m.project_id = r.project_id
  where m.user_id = auth.uid() and m.role >= min_role;
$$;

create or replace function public.project_role_of(p_project uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.project_members m where m.project_id = p_project and m.user_id = auth.uid();
$$;

-- People who share at least one project with the caller (plus the caller).
create or replace function public.my_colleague_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid()
  union
  select other.user_id
  from public.project_members mine
  join public.project_members other on other.project_id = mine.project_id
  where mine.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;

-- Projects are created through create_project() (below), which adds the
-- creator as owner in the same transaction. A plain INSERT + trigger would
-- fail RLS on RETURNING, since membership doesn't exist yet at that point.

create policy "projects: read" on public.projects
  for select to authenticated using (id in (select public.my_project_ids('VIEWER')));
create policy "projects: update" on public.projects
  for update to authenticated
  using (id in (select public.my_project_ids('ADMIN')))
  with check (id in (select public.my_project_ids('ADMIN')));
create policy "projects: delete" on public.projects
  for delete to authenticated using (id in (select public.my_project_ids('OWNER')));

create policy "project_members: read" on public.project_members
  for select to authenticated using (project_id in (select public.my_project_ids('VIEWER')));

create policy "project_invitations: read" on public.project_invitations
  for select to authenticated using (project_id in (select public.my_project_ids('ADMIN')));

-- Replace the "any authenticated user" policies with project-scoped ones.
drop policy "profiles: read" on public.profiles;
create policy "profiles: read colleagues" on public.profiles
  for select to authenticated using (id in (select public.my_colleague_ids()));

drop policy "sprints: read" on public.sprints;
drop policy "sprints: insert" on public.sprints;
drop policy "sprints: update" on public.sprints;
drop policy "sprints: delete" on public.sprints;
create policy "sprints: read" on public.sprints
  for select to authenticated using (project_id in (select public.my_project_ids('VIEWER')));
create policy "sprints: insert" on public.sprints
  for insert to authenticated with check (project_id in (select public.my_project_ids('MEMBER')));
create policy "sprints: update" on public.sprints
  for update to authenticated
  using (project_id in (select public.my_project_ids('MEMBER')))
  with check (project_id in (select public.my_project_ids('MEMBER')));
create policy "sprints: delete" on public.sprints
  for delete to authenticated using (project_id in (select public.my_project_ids('ADMIN')));

drop policy "releases: read" on public.releases;
drop policy "releases: insert" on public.releases;
drop policy "releases: update" on public.releases;
drop policy "releases: delete" on public.releases;
create policy "releases: read" on public.releases
  for select to authenticated using (project_id in (select public.my_project_ids('VIEWER')));
create policy "releases: insert" on public.releases
  for insert to authenticated with check (project_id in (select public.my_project_ids('MEMBER')));
create policy "releases: update" on public.releases
  for update to authenticated
  using (project_id in (select public.my_project_ids('MEMBER')))
  with check (project_id in (select public.my_project_ids('MEMBER')));
create policy "releases: delete" on public.releases
  for delete to authenticated using (project_id in (select public.my_project_ids('ADMIN')));

drop policy "release_tasks: read" on public.release_tasks;
drop policy "release_tasks: update" on public.release_tasks;
create policy "release_tasks: read" on public.release_tasks
  for select to authenticated using (release_id in (select public.my_release_ids('VIEWER')));
create policy "release_tasks: update" on public.release_tasks
  for update to authenticated
  using (release_id in (select public.my_release_ids('MEMBER')))
  with check (release_id in (select public.my_release_ids('MEMBER')));

drop policy "reports: read" on public.reports;
drop policy "reports: update" on public.reports;
create policy "reports: read" on public.reports
  for select to authenticated using (release_id in (select public.my_release_ids('VIEWER')));
create policy "reports: update" on public.reports
  for update to authenticated
  using (release_id in (select public.my_release_ids('MEMBER')))
  with check (release_id in (select public.my_release_ids('MEMBER')));

drop policy "approvals: read" on public.approvals;
drop policy "approvals: update" on public.approvals;
create policy "approvals: read" on public.approvals
  for select to authenticated using (release_id in (select public.my_release_ids('VIEWER')));
create policy "approvals: update" on public.approvals
  for update to authenticated
  using (release_id in (select public.my_release_ids('MEMBER')))
  with check (release_id in (select public.my_release_ids('MEMBER')));

drop policy "activity_log: read" on public.activity_log;
create policy "activity_log: read" on public.activity_log
  for select to authenticated using (project_id in (select public.my_project_ids('VIEWER')));

-- ---------------------------------------------------------------------------
-- Membership & invitation API. All writes to project_members and
-- project_invitations go through these; there are no direct write policies.
-- ---------------------------------------------------------------------------

create or replace function public.require_project_role(p_project uuid, min_role public.project_role)
returns public.project_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_role public.project_role := public.project_role_of(p_project);
begin
  if caller_role is null or caller_role < min_role then
    raise exception 'You need the % role in this project to do that', lower(min_role::text)
      using errcode = 'insufficient_privilege';
  end if;
  return caller_role;
end;
$$;

create or replace function public.log_project_event(p_project uuid, p_action text, p_description text, p_metadata jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log (project_id, release_id, user_id, action, description, metadata)
  values (p_project, null, auth.uid(), p_action, p_description, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.create_project(p_name text, p_description text default null, p_sprints_enabled boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  insert into public.projects (name, description, sprints_enabled, created_by)
  values (trim(p_name), nullif(trim(p_description), ''), p_sprints_enabled, auth.uid())
  returning id into new_id;
  insert into public.project_members (project_id, user_id, role) values (new_id, auth.uid(), 'OWNER');
  perform public.log_project_event(new_id, 'project.created', format('created the project %s', trim(p_name)), null);
  return new_id;
end;
$$;

-- Invite by email. Existing users are added immediately ('added');
-- otherwise a pending invitation activates when their account is created ('invited').
create or replace function public.invite_by_email(p_project uuid, p_email text, p_role public.project_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(p_email));
  target uuid;
begin
  perform public.require_project_role(p_project, 'ADMIN');
  if p_role = 'OWNER' then
    raise exception 'Invite as admin, then promote to owner' using errcode = 'check_violation';
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That is not a valid email address' using errcode = 'check_violation';
  end if;

  select p.id into target from public.profiles p where lower(p.email) = normalized;
  if target is not null then
    if exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = target) then
      raise exception 'That person is already a member of this project' using errcode = 'unique_violation';
    end if;
    insert into public.project_members (project_id, user_id, role, invited_by)
    values (p_project, target, p_role, auth.uid());
    perform public.log_project_event(p_project, 'member.added',
      format('added %s as %s', normalized, lower(p_role::text)), jsonb_build_object('user_id', target, 'role', p_role));
    return 'added';
  end if;

  insert into public.project_invitations (project_id, role, email, created_by)
  values (p_project, p_role, normalized, auth.uid())
  on conflict (project_id, email) where email is not null and accepted_at is null and revoked_at is null
  do update set role = excluded.role, created_by = excluded.created_by, created_at = now();
  perform public.log_project_event(p_project, 'invitation.created',
    format('invited %s as %s', normalized, lower(p_role::text)), jsonb_build_object('email', normalized, 'role', p_role));
  return 'invited';
end;
$$;

-- Shareable link. Returns the token once; only its SHA-256 is stored.
create or replace function public.create_invite_link(p_project uuid, p_role public.project_role, p_expires_in_days int default 7)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
begin
  perform public.require_project_role(p_project, 'ADMIN');
  if p_role = 'OWNER' then
    raise exception 'Links cannot grant the owner role' using errcode = 'check_violation';
  end if;
  if p_expires_in_days not between 1 and 90 then
    raise exception 'Links can be valid for 1 to 90 days' using errcode = 'check_violation';
  end if;
  insert into public.project_invitations (project_id, role, token_hash, created_by, expires_at)
  values (p_project, p_role, encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid(),
          now() + make_interval(days => p_expires_in_days));
  perform public.log_project_event(p_project, 'invitation.link_created',
    format('created an invite link (%s, %s days)', lower(p_role::text), p_expires_in_days),
    jsonb_build_object('role', p_role, 'expires_in_days', p_expires_in_days));
  return token;
end;
$$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.project_invitations;
begin
  select * into inv from public.project_invitations where id = p_invitation;
  if inv.id is null then
    raise exception 'Invitation not found' using errcode = 'no_data_found';
  end if;
  perform public.require_project_role(inv.project_id, 'ADMIN');
  update public.project_invitations set revoked_at = now() where id = p_invitation and revoked_at is null;
  perform public.log_project_event(inv.project_id, 'invitation.revoked',
    case when inv.email is not null then format('revoked the invitation for %s', inv.email)
         else 'revoked an invite link' end, jsonb_build_object('invitation_id', inv.id));
end;
$$;

-- What a link invites to (shown before accepting). Signed-in users only.
create or replace function public.invite_link_info(p_token text)
returns table (project_id uuid, project_name text, role public.project_role, already_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, i.role,
         exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = auth.uid())
  from public.project_invitations i
  join public.projects p on p.id = i.project_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and i.revoked_at is null
    and (i.expires_at is null or i.expires_at > now())
    and auth.uid() is not null;
$$;

create or replace function public.accept_invite_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.project_invitations;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into inv from public.project_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null and (expires_at is null or expires_at > now());
  if inv.id is null then
    raise exception 'This invite link is invalid or has expired' using errcode = 'no_data_found';
  end if;

  -- Existing members keep their role (a link never changes it).
  insert into public.project_members (project_id, user_id, role, invited_by)
  values (inv.project_id, auth.uid(), inv.role, inv.created_by)
  on conflict (project_id, user_id) do nothing;
  if found then
    update public.project_invitations set use_count = use_count + 1 where id = inv.id;
    perform public.log_project_event(inv.project_id, 'member.joined',
      format('joined via invite link as %s', lower(inv.role::text)), jsonb_build_object('invitation_id', inv.id));
  end if;
  return inv.project_id;
end;
$$;

-- Role changes. Admins manage everyone below owner; only owners manage
-- owners; a project always keeps at least one owner.
create or replace function public.set_member_role(p_project uuid, p_user uuid, p_role public.project_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.project_role := public.require_project_role(p_project, 'ADMIN');
  target_role public.project_role;
begin
  select m.role into target_role from public.project_members m where m.project_id = p_project and m.user_id = p_user;
  if target_role is null then
    raise exception 'That person is not a member of this project' using errcode = 'no_data_found';
  end if;
  if (target_role = 'OWNER' or p_role = 'OWNER') and actor_role <> 'OWNER' then
    raise exception 'Only owners can change owner roles' using errcode = 'insufficient_privilege';
  end if;
  if target_role = 'OWNER' and p_role <> 'OWNER'
     and (select count(*) from public.project_members m where m.project_id = p_project and m.role = 'OWNER') = 1 then
    raise exception 'A project needs at least one owner' using errcode = 'check_violation';
  end if;
  update public.project_members set role = p_role where project_id = p_project and user_id = p_user;
  perform public.log_project_event(p_project, 'member.role_changed',
    format('changed %s from %s to %s', (select p.name from public.profiles p where p.id = p_user),
           lower(target_role::text), lower(p_role::text)),
    jsonb_build_object('user_id', p_user, 'from', target_role, 'to', p_role));
end;
$$;

-- Remove a member (admins+) or leave (anyone, for themselves).
create or replace function public.remove_member(p_project uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.project_role := public.project_role_of(p_project);
  target_role public.project_role;
  leaving boolean := p_user = auth.uid();
begin
  if actor_role is null then
    raise exception 'You are not a member of this project' using errcode = 'insufficient_privilege';
  end if;
  select m.role into target_role from public.project_members m where m.project_id = p_project and m.user_id = p_user;
  if target_role is null then
    raise exception 'That person is not a member of this project' using errcode = 'no_data_found';
  end if;
  if not leaving then
    perform public.require_project_role(p_project, 'ADMIN');
    if target_role = 'OWNER' and actor_role <> 'OWNER' then
      raise exception 'Only owners can remove owners' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if target_role = 'OWNER'
     and (select count(*) from public.project_members m where m.project_id = p_project and m.role = 'OWNER') = 1 then
    raise exception 'A project needs at least one owner. Promote someone else first.' using errcode = 'check_violation';
  end if;
  delete from public.project_members where project_id = p_project and user_id = p_user;
  perform public.log_project_event(p_project, case when leaving then 'member.left' else 'member.removed' end,
    case when leaving then 'left the project'
         else format('removed %s', (select p.name from public.profiles p where p.id = p_user)) end,
    jsonb_build_object('user_id', p_user));
end;
$$;

-- Pending email invitations activate when the account is created.
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

  insert into public.project_members (project_id, user_id, role, invited_by)
  select i.project_id, new.id, i.role, i.created_by
  from public.project_invitations i
  where i.email = lower(new.email) and i.accepted_at is null and i.revoked_at is null
  on conflict do nothing;

  update public.project_invitations
  set accepted_at = now()
  where email = lower(new.email) and accepted_at is null and revoked_at is null;

  return new;
end;
$$;

-- Only signed-in users may call the API functions.
revoke execute on function
  public.create_project(text, text, boolean),
  public.invite_by_email(uuid, text, public.project_role),
  public.create_invite_link(uuid, public.project_role, int),
  public.revoke_invitation(uuid),
  public.invite_link_info(text),
  public.accept_invite_link(text),
  public.set_member_role(uuid, uuid, public.project_role),
  public.remove_member(uuid, uuid),
  public.require_project_role(uuid, public.project_role),
  public.log_project_event(uuid, text, text, jsonb),
  public.my_project_ids(public.project_role),
  public.my_release_ids(public.project_role),
  public.my_colleague_ids(),
  public.project_role_of(uuid)
from public, anon;
grant execute on function
  public.create_project(text, text, boolean),
  public.invite_by_email(uuid, text, public.project_role),
  public.create_invite_link(uuid, public.project_role, int),
  public.revoke_invitation(uuid),
  public.invite_link_info(text),
  public.accept_invite_link(text),
  public.set_member_role(uuid, uuid, public.project_role),
  public.remove_member(uuid, uuid),
  public.my_project_ids(public.project_role),
  public.my_release_ids(public.project_role),
  public.my_colleague_ids(),
  public.project_role_of(uuid)
to authenticated;
-- Internal helpers: not callable through the API at all.
revoke execute on function
  public.require_project_role(uuid, public.project_role),
  public.log_project_event(uuid, text, text, jsonb)
from authenticated;

-- ---------------------------------------------------------------------------
-- Search: scoped by RLS to the caller's projects; returns the project too.
-- ---------------------------------------------------------------------------

drop function public.search_releases(text, int);
create function public.search_releases(q text, max_results int default 20)
returns table (
  id uuid,
  name text,
  version text,
  project_id uuid,
  project_name text,
  sprint_name text,
  owner_name text,
  planned_deployment_date date,
  actual_deployment_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pattern as (
    select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  )
  select r.id, r.name, r.version, pr.id, pr.name, s.name, o.name, r.planned_deployment_date, r.actual_deployment_date
  from public.releases r
  join public.projects pr on pr.id = r.project_id
  left join public.sprints s on s.id = r.sprint_id
  left join public.profiles o on o.id = r.owner_id
  cross join pattern
  where length(trim(q)) > 0
    and (r.name ilike pattern.p or r.version ilike pattern.p or pr.name ilike pattern.p
         or s.name ilike pattern.p or o.name ilike pattern.p)
  order by
    (r.name ilike pattern.p or r.version ilike pattern.p) desc,
    r.actual_deployment_date is not null,
    r.planned_deployment_date desc
  limit least(greatest(max_results, 1), 50);
$$;
revoke execute on function public.search_releases(text, int) from public, anon;
grant execute on function public.search_releases(text, int) to authenticated;
