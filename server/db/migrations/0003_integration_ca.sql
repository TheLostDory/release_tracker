-- Company HTTPS certificates (custom certificate authorities) per integration.
-- Not a secret: certificates are public. Trusted in addition to the standard
-- public CAs, only for that integration's requests.

alter table integrations
  add column ca_cert text,
  add constraint integrations_ca_cert_check check (
    ca_cert is null or (length(ca_cert) <= 65536 and ca_cert like '%-----BEGIN CERTIFICATE-----%')
  );

grant select (ca_cert), insert (ca_cert), update (ca_cert) on integrations to release_tracker_app;

-- The background Jenkins sync needs the certificate too.
drop function jenkins_jobs_to_sync();
create function jenkins_jobs_to_sync()
returns table (job_id uuid, release_id uuid, project_id uuid, job_path text, purpose jenkins_job_purpose,
               integration_id uuid, base_url text, username text, secret_encrypted text, ca_cert text, last_build jsonb)
language sql stable security definer set search_path = public
as $$
  select j.id, r.id, r.project_id, j.job_path, j.purpose, i.id, i.base_url, i.username, i.secret_encrypted, i.ca_cert, j.last_build
  from release_jenkins_jobs j
  join releases r on r.id = j.release_id
  join integrations i on i.project_id = r.project_id and i.kind = 'JENKINS'
  where r.actual_deployment_date is null
$$;
grant execute on function jenkins_jobs_to_sync() to release_tracker_app;
