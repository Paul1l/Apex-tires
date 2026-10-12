-- Application role of APEX WHEELS (SEC-11): the running app connects as this
-- role; migrations and backups use the schema owner (POSTGRES_USER).
--
-- The role may read and change data only:
--   SELECT, INSERT, UPDATE, DELETE on tables; USAGE, SELECT on sequences;
--   EXECUTE on functions. No DDL (no CREATE on the schema or the database, no
--   temporary tables, not the owner of any object), no TRUNCATE, no
--   SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS, no access to the
--   migration journal.
-- Default privileges give the same rights on tables, sequences and functions
-- that later migrations create as the owner.
--
-- Idempotent: safe to run again on an existing database (it also resets the
-- password from POSTGRES_APP_PASSWORD and takes back extra rights).
--   * empty data directory: run automatically by the postgres image
--     (mounted to /docker-entrypoint-initdb.d) as POSTGRES_USER;
--   * existing database (see docs/VDS_DEPLOYMENT.md):
--       docker compose ... exec -T postgres sh -c \
--         'psql -v ON_ERROR_STOP=1 --no-psqlrc -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--          -f /docker-entrypoint-initdb.d/10-app-role.sql'
-- Run it as the schema owner (POSTGRES_USER) in the application database.
-- Role name and password come from the environment of the postgres container
-- (psql \getenv), never from this file.

\set ON_ERROR_STOP on
\set app_user apex_app
\getenv app_user POSTGRES_APP_USER
\set app_password ''
\getenv app_password POSTGRES_APP_PASSWORD

-- Checks: a readable error stops the script (and the first start of the container).
SELECT format('DO $check$BEGIN RAISE EXCEPTION %L; END$check$',
  'POSTGRES_APP_PASSWORD: задайте пароль роли приложения длиной не менее 16 символов')
WHERE length(:'app_password') < 16
\gexec
SELECT format('DO $check$BEGIN RAISE EXCEPTION %L; END$check$',
  'POSTGRES_APP_USER должен отличаться от владельца схемы (POSTGRES_USER)')
WHERE :'app_user' = current_user
\gexec

BEGIN;

-- Role: created once, attributes and password set on every run.
SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L',
  :'app_user', :'app_password')
\gexec

-- Database and schema: connect and use, never create.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec
SELECT format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC, %I', current_database(), :'app_user')
\gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user')
\gexec

-- Existing objects.
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user')
\gexec
SELECT format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user')
\gexec
SELECT format('REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', :'app_user')
\gexec

-- Objects that future migrations create (they run as this owner role).
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', current_user, :'app_user')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', current_user, :'app_user')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', current_user, :'app_user')
\gexec

-- No "already exists, skipping" notice on repeated runs.
SET LOCAL client_min_messages = warning;

-- The migration journal belongs to the owner only. Created here (same
-- definition as in run-migrations.ts and 001) so that it exists before the
-- first migration and does not receive the default privileges above.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT format('REVOKE ALL ON TABLE schema_migrations FROM %I', :'app_user')
\gexec

COMMIT;

SELECT format('Роль приложения %s готова: только чтение и изменение данных, без DDL.', :'app_user') AS result;
