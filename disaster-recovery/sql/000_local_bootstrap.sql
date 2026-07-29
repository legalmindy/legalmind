-- LegalMind Yemen — Local backup DB bootstrap (non-destructive)
-- Creates Supabase-compatible stubs so migrations can apply on plain PostgreSQL.
-- NEVER drops databases/schemas/tables.

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticator noinherit login password 'local_authenticator';
exception when duplicate_object then null; end $$;

grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to service_role;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists private;
create schema if not exists extensions;
create schema if not exists realtime;
create schema if not exists supabase_migrations;

grant usage on schema auth to postgres, anon, authenticated, service_role;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant usage on schema private to postgres, anon, authenticated, service_role;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token text,
  confirmation_sent_at timestamptz,
  recovery_token text,
  recovery_sent_at timestamptz,
  email_change_token_new text,
  email_change text,
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  phone text,
  phone_confirmed_at timestamptz,
  phone_change text,
  phone_change_token text,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current text,
  email_change_confirm_status smallint,
  banned_until timestamptz,
  reauthentication_token text,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text,
  user_metadata jsonb
);

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);

-- Sync control plane (local-only)
create schema if not exists dr;

create table if not exists dr.sync_state (
  table_schema text not null default 'public',
  table_name text not null,
  last_synced_at timestamptz,
  last_sync_version bigint default 0,
  last_cursor text,
  rows_synced bigint not null default 0,
  status text not null default 'idle',
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (table_schema, table_name)
);

create table if not exists dr.sync_outbox (
  id bigserial primary key,
  table_schema text not null default 'public',
  table_name text not null,
  record_pk text not null,
  op text not null check (op in ('INSERT','UPDATE','DELETE')),
  payload jsonb,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_dr_sync_outbox_pending
  on dr.sync_outbox (next_attempt_at)
  where processed_at is null;

create table if not exists dr.sync_log (
  id bigserial primary key,
  level text not null default 'info',
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists dr.backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  dump_path text,
  sql_path text,
  archive_path text,
  size_bytes bigint,
  integrity_ok boolean,
  integrity_detail jsonb,
  error text
);

create table if not exists dr.restore_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  source_path text,
  target_db text,
  integrity_ok boolean,
  detail jsonb,
  error text
);

create or replace function dr.log_event(p_level text, p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
as $$
  insert into dr.sync_log(level, event, detail) values (p_level, p_event, coalesce(p_detail, '{}'::jsonb));
$$;
