-- Failed tests: the link on the release's report card (Reports step) is
-- also used to find the run's report, and changing it checks the run again.

drop function test_analyses_due();
create function test_analyses_due()
returns table (run_id uuid, release_id uuid, project_id uuid, purpose jenkins_job_purpose, job_path text, build_number integer,
               status jsonb, attempts integer, automation jsonb, report_url text, card_report_url text,
               jenkins_base_url text, jenkins_username text, jenkins_secret text, jenkins_ca text,
               jira_id uuid, jira_base_url text, jira_auth integration_auth, jira_username text, jira_secret text, jira_ca text, jira_settings jsonb)
language sql stable security definer set search_path = public
as $$
  select a.run_id, a.release_id, r.project_id, b.purpose, b.job_path, b.build_number, b.status, a.attempts, p.automation, a.report_url,
         rp.report_url,
         jk.base_url, jk.username, jk.secret_encrypted, jk.ca_cert,
         ji.id, ji.base_url, ji.auth_type, ji.username, ji.secret_encrypted, ji.ca_cert, ji.settings
  from release_test_analyses a
  join release_jenkins_builds b on b.id = a.run_id
  join releases r on r.id = a.release_id
  join projects p on p.id = r.project_id
  join integrations jk on jk.project_id = r.project_id and jk.kind = 'JENKINS'
  left join integrations ji on ji.project_id = r.project_id and ji.kind = 'JIRA'
  left join reports rp on rp.release_id = a.release_id and rp.report_type::text = b.purpose::text
  where a.state = 'pending' and a.attempts < 3
  order by a.requested_at
  limit 20
$$;
grant execute on function test_analyses_due() to release_tracker_app;

-- A report card's link set by hand → the run of that kind is checked again.
create function requeue_analysis_on_report_link() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update release_test_analyses a
  set state = 'pending', error = null, attempts = 0, requested_at = now()
  from release_jenkins_builds b
  where b.id = a.run_id and a.release_id = new.release_id and b.purpose::text = new.report_type::text
    and a.state <> 'pending'
    -- Not the link the run itself filled in.
    and new.report_url not in (coalesce(b.status ->> 'reportUrl', ''), coalesce(b.status ->> 'url', ''));
  return null;
end;
$$;
create trigger reports_requeue_analysis after update of report_url on reports
  for each row when (new.report_url is not null and new.report_url is distinct from old.report_url)
  execute function requeue_analysis_on_report_link();
