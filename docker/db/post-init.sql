-- Runs once, after the Supabase Postgres image initialises a fresh volume
-- (mounted at /etc/postgresql.schema.sql). Gives the service roles the
-- stack's password and prepares what Auth/Realtime expect.
\set pgpass `echo "$PGPASSWORD"`
\set jwt_secret `echo "$JWT_SECRET"`

alter user authenticator         with password :'pgpass';
alter user supabase_auth_admin   with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';
alter user postgres              with password :'pgpass';

alter database postgres set "app.settings.jwt_secret" to :'jwt_secret';
alter database postgres set "app.settings.jwt_exp" to '3600';

-- Realtime keeps its own state here.
create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;
