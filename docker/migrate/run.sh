#!/bin/sh
# Release Tracker database runner (Docker stack).
#
#   run.sh                         apply pending migrations, then seed once (if SEED=true)
#   run.sh create-user EMAIL PASSWORD "Full Name"
#
# Uses the same migration files as `supabase db push` and records them in
# supabase_migrations.schema_migrations, like the Supabase CLI.
set -eu

export PGHOST="${PGHOST:-db}" PGPORT="${PGPORT:-5432}" PGDATABASE="${PGDATABASE:-postgres}"
export PGUSER="${PGUSER:-postgres}" PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/supabase/migrations}"
SEED_FILE="${SEED_FILE:-/supabase/seed.sql}"

psql_q() { psql -v ON_ERROR_STOP=1 --no-psqlrc -qtA "$@"; }

wait_for_auth_schema() {
  # Auth (GoTrue) migrates the auth schema on startup; the seed needs it complete.
  printf 'Waiting for database and auth schema'
  i=0
  until psql_q -c "select 1 from information_schema.columns
                   where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'" 2>/dev/null | grep -q 1; do
    i=$((i + 1))
    [ "$i" -gt 120 ] && { echo; echo 'Timed out waiting for the auth schema.' >&2; exit 1; }
    printf '.'
    sleep 1
  done
  echo ' ready.'
}

migrate() {
  psql_q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, name text, statements text[]
);
create table if not exists supabase_migrations.seed_files (
  path text primary key, hash text not null
);
SQL

  applied=0
  for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
    base=$(basename "$file" .sql)
    version=${base%%_*}
    name=${base#*_}
    if [ -n "$(psql_q -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")" ]; then
      continue
    fi
    echo "Applying $base"
    # One transaction per migration: all or nothing.
    psql -v ON_ERROR_STOP=1 --no-psqlrc -q --single-transaction \
      -f "$file" \
      -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
    applied=$((applied + 1))
  done
  echo "Migrations: $applied applied, database up to date."

  if [ "${SEED:-true}" = "true" ] && [ -f "$SEED_FILE" ]; then
    if [ -z "$(psql_q -c "select 1 from supabase_migrations.seed_files where path = 'seed.sql'")" ]; then
      echo 'Loading demo data (seed.sql)'
      hash=$(sha256sum "$SEED_FILE" | cut -d' ' -f1)
      psql -v ON_ERROR_STOP=1 --no-psqlrc -q --single-transaction -f "$SEED_FILE" \
        -c "insert into supabase_migrations.seed_files (path, hash) values ('seed.sql', '$hash')"
    else
      echo 'Demo data already loaded.'
    fi
  fi

  # Make PostgREST pick up schema changes immediately.
  psql_q -c "notify pgrst, 'reload schema'"
}

create_user() {
  email="${1:?usage: create-user EMAIL PASSWORD \"Full Name\"}"
  password="${2:?usage: create-user EMAIL PASSWORD \"Full Name\"}"
  name="${3:-}"
  [ "${#password}" -ge 10 ] || { echo 'Password must be at least 10 characters.' >&2; exit 1; }
  psql -v ON_ERROR_STOP=1 --no-psqlrc -q --single-transaction \
    -v email="$email" -v password="$password" -v name="$name" <<'SQL'
with new_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    lower(:'email'), extensions.crypt(:'password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    case when :'name' = '' then '{}'::jsonb else jsonb_build_object('name', :'name') end,
    now(), now(), '', '', '', ''
  ) returning id, email
)
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from new_user;
SQL
  echo "Created $email"
}

wait_for_auth_schema
case "${1:-migrate}" in
  migrate) migrate ;;
  create-user) shift; create_user "$@" ;;
  *) echo "Unknown command: $1 (use: migrate | create-user)" >&2; exit 1 ;;
esac
