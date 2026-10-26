-- Automation: steps that complete themselves when the evidence appears.
--   RC creation  ← the RC branch exists on GitHub (every configured repository)
--   Deployment   ← the release's Jira version is marked released
-- Read and written only through these functions by the server's worker.

-- Open (not deployed) releases with what the checks need.
create function auto_complete_candidates()
returns table (release_id uuid, project_id uuid, name text, version text, jira_version_id text,
               rc_open boolean, deploy_open boolean, rc_from_github boolean, deploy_from_jira boolean,
               code_refs jsonb,
               gh_base_url text, gh_secret text, gh_ca text, gh_settings jsonb,
               jira_integration_id uuid, jira_base_url text, jira_auth integration_auth, jira_username text,
               jira_secret text, jira_ca text, jira_settings jsonb)
language sql stable security definer set search_path = public
as $$
  select r.id, r.project_id, r.name, r.version, r.jira_version_id,
         exists (select 1 from release_tasks t where t.release_id = r.id and t.task_type = 'RC_CREATION' and t.status not in ('COMPLETED', 'SKIPPED')),
         exists (select 1 from release_tasks t where t.release_id = r.id and t.task_type = 'DEPLOYMENT' and t.status not in ('COMPLETED', 'SKIPPED')),
         coalesce((p.automation -> 'autoComplete' ->> 'rcCreationFromGithub')::boolean, true),
         coalesce((p.automation -> 'autoComplete' ->> 'deploymentFromJira')::boolean, true),
         coalesce((select jsonb_agg(jsonb_build_object('repo', c.repo, 'head', c.head_ref)) from release_code_refs c where c.release_id = r.id), '[]'::jsonb),
         gh.base_url, gh.secret_encrypted, gh.ca_cert, gh.settings,
         ji.id, ji.base_url, ji.auth_type, ji.username, ji.secret_encrypted, ji.ca_cert, ji.settings
  from releases r
  join projects p on p.id = r.project_id
  left join integrations gh on gh.project_id = r.project_id and gh.kind = 'GITHUB'
  left join integrations ji on ji.project_id = r.project_id and ji.kind = 'JIRA'
  where r.actual_deployment_date is null and (gh.id is not null or ji.id is not null)
$$;

-- Completes an open step, noting why in the activity log. False if it was already done.
create function complete_step_by_automation(p_release uuid, p_step workflow_task_type, p_reason text) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  done integer;
begin
  update release_tasks set status = 'COMPLETED'
  where release_id = p_release and task_type = p_step and status not in ('COMPLETED', 'SKIPPED');
  get diagnostics done = row_count;
  if done > 0 then
    insert into activity_log (release_id, user_id, action, description, metadata)
    values (p_release, null, 'automation.completed', p_reason, jsonb_build_object('step', p_step));
  end if;
  return done > 0;
end;
$$;

-- Marks the release deployed on p_date and completes its Deployment step.
create function mark_deployed_by_automation(p_release uuid, p_date date, p_reason text) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  changed integer;
begin
  update releases set actual_deployment_date = p_date where id = p_release and actual_deployment_date is null;
  get diagnostics changed = row_count;
  if changed = 0 then return false; end if;
  perform complete_step_by_automation(p_release, 'DEPLOYMENT', p_reason);
  return true;
end;
$$;

grant execute on function auto_complete_candidates(), complete_step_by_automation(uuid, workflow_task_type, text),
  mark_deployed_by_automation(uuid, date, text) to release_tracker_app;
