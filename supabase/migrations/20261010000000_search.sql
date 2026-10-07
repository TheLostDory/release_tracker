-- Global search across release name, version, sprint and owner.
-- security invoker: RLS applies exactly as for direct table reads.
create or replace function public.search_releases(q text, max_results int default 20)
returns table (
  id uuid,
  name text,
  version text,
  sprint_id uuid,
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
    -- Treat user input literally: escape LIKE wildcards.
    select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  )
  select r.id, r.name, r.version, s.id, s.name, o.name, r.planned_deployment_date, r.actual_deployment_date
  from public.releases r
  join public.sprints s on s.id = r.sprint_id
  left join public.profiles o on o.id = r.owner_id
  cross join pattern
  where length(trim(q)) > 0
    and (r.name ilike pattern.p or r.version ilike pattern.p
         or s.name ilike pattern.p or o.name ilike pattern.p)
  order by
    (r.name ilike pattern.p or r.version ilike pattern.p) desc,  -- direct hits first
    r.actual_deployment_date is not null,                         -- open releases first
    r.planned_deployment_date desc
  limit least(greatest(max_results, 1), 50);
$$;

revoke execute on function public.search_releases(text, int) from anon;
