-- Failed tests: the report can also be a page linked on the build (HTML
-- Publisher), a per-project path, or a link pasted for one run.

alter table release_test_analyses add column report_url text,
  add constraint release_test_analyses_report_url_check check (report_url is null or (report_url ~* '^https?://' and length(report_url) <= 2000));

-- "Check again", optionally with the report's link (members).
drop function request_test_analysis(uuid);
create function request_test_analysis(p_run uuid, p_report_url text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  run release_jenkins_builds;
begin
  select * into run from release_jenkins_builds where id = p_run;
  if run.id is null or run.release_id not in (select my_release_ids('MEMBER')) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into release_test_analyses (run_id, release_id, report_url) values (run.id, run.release_id, p_report_url)
  on conflict (run_id) do update
  set state = 'pending', error = null, attempts = 0, requested_at = now(),
      report_url = coalesce(excluded.report_url, release_test_analyses.report_url);
end;
$$;

drop function test_analyses_due();
create function test_analyses_due()
returns table (run_id uuid, release_id uuid, project_id uuid, purpose jenkins_job_purpose, job_path text, build_number integer,
               status jsonb, attempts integer, automation jsonb, report_url text,
               jenkins_base_url text, jenkins_username text, jenkins_secret text, jenkins_ca text,
               jira_id uuid, jira_base_url text, jira_auth integration_auth, jira_username text, jira_secret text, jira_ca text, jira_settings jsonb)
language sql stable security definer set search_path = public
as $$
  select a.run_id, a.release_id, r.project_id, b.purpose, b.job_path, b.build_number, b.status, a.attempts, p.automation, a.report_url,
         jk.base_url, jk.username, jk.secret_encrypted, jk.ca_cert,
         ji.id, ji.base_url, ji.auth_type, ji.username, ji.secret_encrypted, ji.ca_cert, ji.settings
  from release_test_analyses a
  join release_jenkins_builds b on b.id = a.run_id
  join releases r on r.id = a.release_id
  join projects p on p.id = r.project_id
  join integrations jk on jk.project_id = r.project_id and jk.kind = 'JENKINS'
  left join integrations ji on ji.project_id = r.project_id and ji.kind = 'JIRA'
  where a.state = 'pending' and a.attempts < 3
  order by a.requested_at
  limit 20
$$;

grant execute on function request_test_analysis(uuid, text), test_analyses_due() to release_tracker_app;
