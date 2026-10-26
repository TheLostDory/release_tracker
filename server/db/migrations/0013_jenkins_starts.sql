-- Automation: start the project's automated Jenkins jobs for a release (a
-- button, or when RC creation completes) and follow the runs they start.
-- A start goes: to_start → queued (Jenkins queue item) → the run becomes a
-- followed run of the Automated jobs step (and the start row is removed).

create table release_jenkins_starts (
  id           uuid primary key default gen_random_uuid(),
  release_id   uuid not null references releases (id) on delete cascade,
  purpose      jenkins_job_purpose not null,
  job_path     text not null,
  -- Already filled in ({{version}} → 7.0.0).
  parameters   jsonb not null default '{}'::jsonb,
  state        text not null default 'to_start' check (state in ('to_start', 'queued', 'failed')),
  queue_url    text,
  attempts     integer not null default 0,
  last_error   text,
  requested_by uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint release_jenkins_starts_path_check check (length(job_path) between 1 and 300 and job_path !~ '(^|/)\.\.(/|$)')
);
create index release_jenkins_starts_release_idx on release_jenkins_starts (release_id);

alter table release_jenkins_starts enable row level security;
create policy jenkins_starts_read on release_jenkins_starts for select using (release_id in (select my_release_ids('VIEWER')));
create policy jenkins_starts_delete on release_jenkins_starts for delete using (release_id in (select my_release_ids('MEMBER')));
grant select, delete on release_jenkins_starts to release_tracker_app;

-- Queues a start for each job in the project's automation settings (skips
-- jobs that already have a start waiting). Returns how many were queued.
create function request_jenkins_starts_internal(p_release uuid, p_user uuid) returns integer
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
revoke execute on function request_jenkins_starts_internal(uuid, uuid) from public;

-- "Start jobs" button (members).
create function request_jenkins_starts(p_release uuid) returns integer
language plpgsql security definer set search_path = public
as $$
begin
  if p_release not in (select my_release_ids('MEMBER')) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return request_jenkins_starts_internal(p_release, app_user_id());
end;
$$;
grant execute on function request_jenkins_starts(uuid) to release_tracker_app;

-- When RC creation completes and the project starts jobs automatically.
create function start_jobs_after_rc() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  auto boolean;
begin
  select coalesce((p.automation -> 'jenkins' ->> 'autoStart')::boolean, false) into auto
  from releases r join projects p on p.id = r.project_id where r.id = new.release_id;
  if auto then perform request_jenkins_starts_internal(new.release_id, app_user_id()); end if;
  return null;
end;
$$;
create trigger release_tasks_start_jobs after update on release_tasks
  for each row when (new.task_type = 'RC_CREATION' and new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED')
  execute function start_jobs_after_rc();

-- --- For the server's automation worker (no signed-in user) ----------------------------

create function jenkins_starts_due()
returns table (id uuid, release_id uuid, purpose jenkins_job_purpose, job_path text, parameters jsonb, state text,
               queue_url text, attempts integer, created_at timestamptz,
               base_url text, username text, secret_encrypted text, ca_cert text)
language sql stable security definer set search_path = public
as $$
  select s.id, s.release_id, s.purpose, s.job_path, s.parameters, s.state, s.queue_url, s.attempts, s.created_at,
         i.base_url, i.username, i.secret_encrypted, i.ca_cert
  from release_jenkins_starts s
  join releases r on r.id = s.release_id
  join integrations i on i.project_id = r.project_id and i.kind = 'JENKINS'
  where s.state in ('to_start', 'queued')
  order by s.created_at
$$;

-- Records progress: started (queue URL), or failed (with the reason).
create function jenkins_start_update(p_id uuid, p_state text, p_queue_url text, p_error text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  s release_jenkins_starts;
begin
  update release_jenkins_starts
  set state = p_state, queue_url = coalesce(p_queue_url, queue_url), last_error = p_error,
      attempts = attempts + case when p_error is null then 0 else 1 end, updated_at = now()
  where id = p_id
  returning * into s;
  if p_state = 'queued' and p_queue_url is not null and s.id is not null then
    insert into activity_log (release_id, user_id, action, description, metadata)
    values (s.release_id, s.requested_by, 'jenkins.triggered', format('started Jenkins job %s', s.job_path),
            jsonb_build_object('start_id', s.id, 'purpose', s.purpose));
  end if;
end;
$$;

-- The queued job started build #n: it becomes the step's run for its purpose
-- (replacing an older Load Test / Longevity / HIT run). Returns the run id.
create function jenkins_start_resolved(p_id uuid, p_build_number integer) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  s release_jenkins_starts;
  run_id uuid;
begin
  delete from release_jenkins_starts where id = p_id returning * into s;
  if s.id is null then return null; end if;
  if s.purpose in ('LOAD_TEST', 'LONGEVITY', 'HIT') then
    -- The report link the replaced run filled belongs to it: the new run fills it once it passes.
    update reports set report_url = null
    where release_id = s.release_id and report_type = s.purpose::text::report_type
      and report_url in (select coalesce(b.status ->> 'reportUrl', '') from release_jenkins_builds b where b.release_id = s.release_id and b.purpose = s.purpose
                         union select coalesce(b.status ->> 'url', '') from release_jenkins_builds b where b.release_id = s.release_id and b.purpose = s.purpose);
    delete from release_jenkins_builds where release_id = s.release_id and purpose = s.purpose;
  end if;
  insert into release_jenkins_builds (release_id, job_path, build_number, purpose, created_by)
  values (s.release_id, s.job_path, p_build_number, s.purpose, s.requested_by)
  on conflict (release_id, job_path, build_number) do update set purpose = excluded.purpose
  returning id into run_id;
  return run_id;
end;
$$;

grant execute on function jenkins_starts_due(), jenkins_start_update(uuid, text, text, text),
  jenkins_start_resolved(uuid, integer) to release_tracker_app;
