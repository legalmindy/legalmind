-- LegalMind Yemen — Repair offline-sync schema (idempotent)
-- Run once in Supabase SQL Editor as a single script.
--
-- Root cause: sync_metadata triggers existed before sync_version / updated_at columns
-- were added. Any UPDATE (including backfill) then failed with:
--   record "new" has no field "sync_version"

-- ─── Step 1: Remove triggers BEFORE any UPDATE/ALTER backfill ───────────────
do $$
declare
  t text;
  sync_tables text[] := array[
    'firms', 'employees', 'invitations', 'clients', 'cases',
    'sessions', 'documents', 'case_attachments', 'lawyers', 'notifications'
  ];
begin
  foreach t in array sync_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop trigger if exists sync_metadata_%s on %I', t, t);
    end if;
  end loop;
end $$;

-- ─── Step 2: Ensure required columns exist on every sync table ───────────────
do $$
declare
  t text;
  sync_tables text[] := array[
    'firms', 'employees', 'invitations', 'clients', 'cases',
    'sessions', 'documents', 'case_attachments', 'lawyers', 'notifications'
  ];
begin
  foreach t in array sync_tables loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    -- updated_at (missing on case_attachments, notifications in early schema)
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('alter table %I add column updated_at timestamptz', t);

      if t = 'case_attachments' then
        execute $sql$
          update case_attachments
          set updated_at = coalesce(uploaded_at, now())
          where updated_at is null
        $sql$;
      elsif t = 'notifications' then
        execute $sql$
          update notifications
          set updated_at = coalesce(created_at, now())
          where updated_at is null
        $sql$;
      else
        execute format('update %I set updated_at = now() where updated_at is null', t);
      end if;

      execute format('alter table %I alter column updated_at set default now()', t);
      execute format('alter table %I alter column updated_at set not null', t);
    end if;

    execute format(
      'alter table %I add column if not exists sync_version bigint not null default 1',
      t
    );
    execute format(
      'alter table %I add column if not exists updated_by uuid references employees(id) on delete set null',
      t
    );
    execute format('alter table %I add column if not exists device_id text', t);

    execute format(
      'create index if not exists idx_%s_sync_updated on %I(updated_at, sync_version)',
      t, t
    );
  end loop;
end $$;

-- ─── Step 3: Sync metadata trigger function ──────────────────────────────────
create or replace function bump_sync_metadata()
returns trigger
language plpgsql
as $$
begin
  new.sync_version := coalesce(old.sync_version, 0) + 1;
  new.updated_by := get_current_employee_id();

  if tg_op = 'UPDATE' and (new.updated_at is null or new.updated_at = old.updated_at) then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

-- ─── Step 4: Re-attach triggers only when schema is complete ───────────────
do $$
declare
  t text;
  sync_tables text[] := array[
    'firms', 'employees', 'invitations', 'clients', 'cases',
    'sessions', 'documents', 'case_attachments', 'lawyers', 'notifications'
  ];
begin
  foreach t in array sync_tables loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'sync_version'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      raise notice 'Skipping sync trigger for % — missing sync columns', t;
      continue;
    end if;

    execute format('drop trigger if exists sync_metadata_%s on %I', t, t);
    execute format(
      'create trigger sync_metadata_%s before update on %I for each row execute function bump_sync_metadata()',
      t, t
    );
  end loop;
end $$;
