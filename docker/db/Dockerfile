FROM public.ecr.aws/supabase/postgres:17.11.0.004
# Runs once after the image initialises a fresh data volume.
COPY post-init.sql /etc/postgresql.schema.sql
