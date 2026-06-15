-- Fix: record "new" has no field "sync_version"
-- Also fixes missing updated_at on case_attachments / notifications.

do $$ declare t text; begin
  foreach t in array array[
    'firms',
    'employees',
    'invitations',
    'clients',
    'cases',
    'sessions',
    'documents',
    'case_attachments',
    'lawyers',
    'notifications'
  ]
  loop
    -- Ensure updated_at exists (some tables only had created_at / uploaded_at)
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('alter table %I add column updated_at timestamptz', t);
      if t = 'case_attachments' and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'case_attachments' and column_name = 'uploaded_at'
      ) then
        execute 'update case_attachments set updated_at = uploaded_at where updated_at is null';
      elsif t = 'notifications' and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'notifications' and column_name = 'created_at'
      ) then
        execute 'update notifications set updated_at = created_at where updated_at is null';
      else
        execute format('update %I set updated_at = now() where updated_at is null', t);
      end if;
      execute format('alter table %I alter column updated_at set default now()', t);
      execute format('alter table %I alter column updated_at set not null', t);
    end if;

    execute format('alter table %I add column if not exists sync_version bigint not null default 1', t);
    execute format('alter table %I add column if not exists updated_by uuid references employees(id) on delete set null', t);
    execute format('alter table %I add column if not exists device_id text', t);

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'sync_version'
    ) then
      execute format(
        'create index if not exists idx_%s_sync_updated on %I(updated_at, sync_version)',
        t, t
      );
    end if;
  end loop;
end $$;

create or replace function bump_sync_metadata()
returns trigger as $$
begin
  new.sync_version := coalesce(old.sync_version, 0) + 1;
  new.updated_by := get_current_employee_id();
  if tg_op = 'UPDATE' and (new.updated_at is null or new.updated_at = old.updated_at) then
    new.updated_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

do $$ declare t text; begin
  foreach t in array array[
    'firms',
    'employees',
    'invitations',
    'clients',
    'cases',
    'sessions',
    'documents',
    'case_attachments',
    'lawyers',
    'notifications'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'sync_version'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('drop trigger if exists sync_metadata_%s on %I', t, t);
      execute format(
        'create trigger sync_metadata_%s before update on %I for each row execute function bump_sync_metadata()',
        t, t
      );
    end if;
  end loop;
end $$;
