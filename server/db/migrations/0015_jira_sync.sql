-- Automation: releases follow their Jira versions.
--   importVersions: new unreleased versions become releases
--   syncDates:      target dates (and renamed versions) follow Jira
-- Only through these functions, by the server's worker.

create function jira_sync_targets()
returns table (project_id uuid, import_versions boolean, sync_dates boolean,
               integration_id uuid, base_url text, auth_type integration_auth, username text,
               secret_encrypted text, ca_cert text, settings jsonb)
language sql stable security definer set search_path = public
as $$
  select p.id,
         coalesce((p.automation -> 'jiraSync' ->> 'importVersions')::boolean, false),
         coalesce((p.automation -> 'jiraSync' ->> 'syncDates')::boolean, true),
         i.id, i.base_url, i.auth_type, i.username, i.secret_encrypted, i.ca_cert, i.settings
  from projects p join integrations i on i.project_id = p.id and i.kind = 'JIRA'
  where coalesce((p.automation -> 'jiraSync' ->> 'importVersions')::boolean, false)
     or coalesce((p.automation -> 'jiraSync' ->> 'syncDates')::boolean, true)
$$;

-- The project's releases linked to Jira versions.
create function jira_sync_releases(p_project uuid)
returns table (id uuid, name text, version text, planned_deployment_date date, actual_deployment_date date,
               jira_version_id text, jira_version_name text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.name, r.version, r.planned_deployment_date, r.actual_deployment_date, r.jira_version_id, r.jira_version_name
  from releases r where r.project_id = p_project and r.jira_version_id is not null
$$;

-- A new Jira version becomes a release (like "Import from Jira"). Null if a
-- release with that name already exists.
create function jira_import_version(p_project uuid, p_version_id text, p_name text, p_date date, p_description text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid;
begin
  if exists (select 1 from releases where project_id = p_project and (jira_version_id = p_version_id or (sprint_id is null and name = p_name))) then
    return null;
  end if;
  insert into releases (project_id, name, version, description, planned_deployment_date, jira_version_id, jira_version_name)
  values (p_project, left(p_name, 100), left(p_name, 50), left(p_description, 10000), p_date, p_version_id, p_name)
  returning id into new_id;
  insert into activity_log (release_id, user_id, action, description, metadata)
  values (new_id, null, 'automation.imported', format('Release created automatically from Jira version %s', p_name),
          jsonb_build_object('jira_version_id', p_version_id));
  return new_id;
end;
$$;

-- Follows the Jira version: its release date (target date) and name (the
-- release's name/version too, unless someone changed them in the tracker).
-- Returns what changed.
create function jira_sync_release(p_release uuid, p_name text, p_date date) returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  r releases;
  changes text[] := '{}';
begin
  select * into r from releases where id = p_release;
  if r.id is null or r.actual_deployment_date is not null then return changes; end if;

  if p_date is not null and p_date is distinct from r.planned_deployment_date then
    update releases set planned_deployment_date = p_date where id = p_release;
    changes := changes || format('target date %s → %s', r.planned_deployment_date, p_date);
  end if;

  if p_name is distinct from r.jira_version_name then
    begin
      update releases
      set jira_version_name = p_name,
          name = case when name = r.jira_version_name then left(p_name, 100) else name end,
          version = case when version = r.jira_version_name then left(p_name, 50) else version end
      where id = p_release;
    exception when unique_violation then
      -- Another release already has that name: keep this one's name.
      update releases set jira_version_name = p_name where id = p_release;
    end;
    changes := changes || format('Jira version renamed %s → %s', r.jira_version_name, p_name);
  end if;

  if array_length(changes, 1) > 0 then
    insert into activity_log (release_id, user_id, action, description, metadata)
    values (p_release, null, 'automation.synced', format('Updated from Jira: %s', array_to_string(changes, '; ')), '{}'::jsonb);
  end if;
  return changes;
end;
$$;

grant execute on function jira_sync_targets(), jira_sync_releases(uuid), jira_import_version(uuid, text, text, date, text),
  jira_sync_release(uuid, text, date) to release_tracker_app;
