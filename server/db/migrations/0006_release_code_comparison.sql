-- Compare what was merged into a release candidate (GitHub) with the issues
-- in the release's Jira version.
--
-- GitHub integration: base_url is the API address (https://api.github.com, or
-- https://github.yourcompany.com/api/v3 for Enterprise), the secret a token,
-- settings {"repos": ["owner/name", …]}.

alter table integrations drop constraint integrations_auth_matches_kind;
alter table integrations add constraint integrations_auth_matches_kind check (
  (kind = 'JIRA' and auth_type in ('JIRA_CLOUD', 'JIRA_SERVER'))
  or (kind = 'JENKINS' and auth_type = 'JENKINS')
  or (kind = 'GITHUB' and auth_type = 'GITHUB')
);

-- What to compare, per repository: the commits in head_ref (the RC branch or
-- tag) that aren't in base_ref (the previous release's branch or tag).
create table release_code_refs (
  id          uuid primary key default gen_random_uuid(),
  release_id  uuid not null references releases (id) on delete cascade,
  repo        text not null,
  base_ref    text not null,
  head_ref    text not null,
  created_by  uuid references users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint release_code_refs_unique unique (release_id, repo),
  constraint release_code_refs_repo_check check (repo ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  constraint release_code_refs_ref_check check (
    length(base_ref) between 1 and 250 and length(head_ref) between 1 and 250
    and base_ref !~ '[\s~^:?*\[\\]' and head_ref !~ '[\s~^:?*\[\\]'
    and base_ref !~ '\.\.' and head_ref !~ '\.\.'
  )
);
create index release_code_refs_release_idx on release_code_refs (release_id);
create trigger release_code_refs_set_updated_at before update on release_code_refs for each row execute function set_updated_at();

alter table release_code_refs enable row level security;
create policy code_refs_read on release_code_refs for select using (release_id in (select my_release_ids('VIEWER')));
create policy code_refs_insert on release_code_refs for insert with check (release_id in (select my_release_ids('MEMBER')));
create policy code_refs_update on release_code_refs for update
  using (release_id in (select my_release_ids('MEMBER'))) with check (release_id in (select my_release_ids('MEMBER')));
create policy code_refs_delete on release_code_refs for delete using (release_id in (select my_release_ids('MEMBER')));
grant select, insert, update, delete on release_code_refs to release_tracker_app;
