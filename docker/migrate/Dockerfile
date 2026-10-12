# Same Postgres image (for psql); carries the migrations and seed.
# Rebuilt by `docker compose up --build` whenever they change.
FROM public.ecr.aws/supabase/postgres:17.11.0.004
COPY docker/migrate/run.sh /docker/run.sh
COPY supabase/migrations /supabase/migrations
COPY supabase/seed.sql /supabase/seed.sql
ENTRYPOINT ["/bin/sh", "/docker/run.sh"]
CMD ["migrate"]
