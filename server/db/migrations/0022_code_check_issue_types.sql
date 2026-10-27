-- Code vs Jira: the issue types to compare are a project setting
-- (projects.automation -> codeCheck -> issueTypes); the background check reads them.

drop function code_check_targets();
create function code_check_targets()
returns table (release_id uuid, project_id uuid, name text, version text, jira_version_id text, jira_version_name text,
               refs jsonb,
               gh_id uuid, gh_base_url text, gh_secret text, gh_ca text, gh_settings jsonb,
               jira_id uuid, jira_base_url text, jira_auth integration_auth, jira_username text, jira_secret text, jira_ca text, jira_settings jsonb,
               automation jsonb)
language sql stable security definer set search_path = public
as $$
  select r.id, r.project_id, r.name, r.version, r.jira_version_id, r.jira_version_name,
         (select jsonb_agg(jsonb_build_object('repo', c.repo, 'base_ref', c.base_ref, 'head_ref', c.head_ref) order by c.repo)
          from release_code_refs c where c.release_id = r.id),
         gh.id, gh.base_url, gh.secret_encrypted, gh.ca_cert, gh.settings,
         ji.id, ji.base_url, ji.auth_type, ji.username, ji.secret_encrypted, ji.ca_cert, ji.settings,
         p.automation
  from releases r
  join projects p on p.id = r.project_id
  join integrations gh on gh.project_id = r.project_id and gh.kind = 'GITHUB'
  left join integrations ji on ji.project_id = r.project_id and ji.kind = 'JIRA'
  left join release_code_checks cc on cc.release_id = r.id
  where r.actual_deployment_date is null
    and coalesce((p.automation -> 'codeCheck' ->> 'background')::boolean, true)
    and exists (select 1 from release_code_refs c where c.release_id = r.id)
    and (cc.checked_at is null or cc.checked_at < now() - interval '55 minutes')
$$;
grant execute on function code_check_targets() to release_tracker_app;
