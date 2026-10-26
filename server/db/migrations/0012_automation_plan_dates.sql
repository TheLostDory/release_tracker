-- Per-project automation settings, and the first automation: planned step
-- dates counted back from the target deployment date.
--
-- projects.automation (all optional; defaults in the code and below):
--   {"planDates": {"enabled": true, "offsets": {"RC_CREATION": 14, …}}, …}

alter table projects
  add column automation jsonb not null default '{}'::jsonb,
  add constraint projects_automation_size check (length(automation::text) <= 20000);

-- Days before the target deployment, per step (used when a project sets none).
create function default_step_offsets() returns jsonb
language sql immutable
as $$
  select '{"RELEASE_IDENTIFIED": 21, "RC_CREATION": 14, "AUTOMATED_JOBS": 12, "LOAD_TEST_REVIEW": 9,
           "LONGEVITY_REVIEW": 9, "HIT_REVIEW": 9, "RC_EMAIL": 7, "RTP_CREATION": 5,
           "RC_ESCALATION_EMAIL": 4, "APPROVAL": 2, "RELEASE_EMAIL": 1, "DEPLOYMENT": 0}'::jsonb
$$;

-- A Saturday or Sunday becomes the Friday before.
create function workday_on_or_before(d date) returns date
language sql immutable
as $$
  select case extract(isodow from d) when 6 then d - 1 when 7 then d - 2 else d end
$$;

create function plan_dates_enabled(p_project uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((automation -> 'planDates' ->> 'enabled')::boolean, true) from projects where id = p_project
$$;

-- Sets each open step's planned date from the target date. p_overwrite = false
-- only fills steps without a date.
create function plan_release_dates_internal(p_release uuid, p_overwrite boolean) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  r releases;
  offsets jsonb;
  changed integer;
begin
  select * into r from releases where id = p_release;
  if r.id is null then return 0; end if;
  select default_step_offsets() || coalesce(p.automation -> 'planDates' -> 'offsets', '{}'::jsonb) into offsets
  from projects p where p.id = r.project_id;

  update release_tasks t
  set planned_date = workday_on_or_before(r.planned_deployment_date - (offsets ->> t.task_type::text)::int)
  where t.release_id = p_release
    and t.status not in ('COMPLETED', 'SKIPPED')
    and (p_overwrite or t.planned_date is null)
    and offsets ? t.task_type::text
    and t.planned_date is distinct from workday_on_or_before(r.planned_deployment_date - (offsets ->> t.task_type::text)::int);
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke execute on function plan_release_dates_internal(uuid, boolean) from public;

-- "Plan dates" button: members re-plan every open step.
create function plan_release_dates(p_release uuid) returns integer
language plpgsql security definer set search_path = public
as $$
begin
  if p_release not in (select my_release_ids('MEMBER')) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return plan_release_dates_internal(p_release, true);
end;
$$;
grant execute on function plan_release_dates(uuid) to release_tracker_app;

-- New releases get planned dates (after their steps are created: trigger names run in order).
create function releases_plan_dates() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if plan_dates_enabled(new.project_id) then perform plan_release_dates_internal(new.id, false); end if;
  elsif new.planned_deployment_date is distinct from old.planned_deployment_date and plan_dates_enabled(new.project_id) then
    -- The target moved: open steps move with it, keeping their spacing.
    update release_tasks
    set planned_date = workday_on_or_before(planned_date + (new.planned_deployment_date - old.planned_deployment_date))
    where release_id = new.id and planned_date is not null and status not in ('COMPLETED', 'SKIPPED');
  end if;
  return null;
end;
$$;
create trigger releases_plan_dates after insert or update of planned_deployment_date on releases
  for each row execute function releases_plan_dates();
