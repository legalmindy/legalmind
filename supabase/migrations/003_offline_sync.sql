-- LegalMind Yemen — Offline-first sync support

create table if not exists sync_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null unique,
  firm_id uuid references firms(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  created_by uuid references employees(id) on delete set null,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_events_firm_created on sync_events(firm_id, created_at);
create index if not exists idx_sync_events_table_record on sync_events(table_name, record_id);

-- Drop sync triggers first so backfill UPDATEs never hit bump_sync_metadata prematurely.
do $$ declare t text; begin
  foreach t in array array[
    'firms', 'employees', 'invitations', 'clients', 'cases',
    'sessions', 'documents', 'case_attachments', 'lawyers', 'notifications'
  ]
  loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop trigger if exists sync_metadata_%s on %I', t, t);
    end if;
  end loop;
end $$;

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
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('alter table %I add column updated_at timestamptz', t);
      if t = 'case_attachments' then
        execute 'update case_attachments set updated_at = uploaded_at where updated_at is null';
      elsif t = 'notifications' then
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
    ) then
      execute format('create index if not exists idx_%s_sync_updated on %I(updated_at, sync_version)', t, t);
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
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'sync_version'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('drop trigger if exists sync_metadata_%s on %I', t, t);
      execute format('create trigger sync_metadata_%s before update on %I for each row execute function bump_sync_metadata()', t, t);
    end if;
  end loop;
end $$;

create or replace function ensure_sync_table_allowed(table_name text)
returns void as $$
begin
  if table_name not in (
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
  ) then
    raise exception 'Unsupported sync table: %', table_name;
  end if;
end;
$$ language plpgsql immutable;

create or replace function sync_pull_table(table_name text, since_cursor text default null)
returns setof jsonb as $$
declare
  sql text;
begin
  perform ensure_sync_table_allowed(table_name);
  sql := format(
    'select to_jsonb(t) from %I t
     where ($1 is null or t.updated_at > $1::timestamptz)
     order by t.updated_at asc
     limit 500',
    table_name
  );
  return query execute sql using since_cursor;
end;
$$ language plpgsql security definer;

create or replace function sync_apply_event(
  event_id text,
  table_name text,
  record_id uuid,
  firm_id uuid,
  event_type text,
  payload jsonb
)
returns void as $$
declare
  existing_event uuid;
begin
  perform ensure_sync_table_allowed(table_name);

  select id into existing_event from sync_events where client_event_id = event_id;
  if existing_event is not null then
    return;
  end if;

  insert into sync_events(client_event_id, firm_id, table_name, record_id, event_type, payload, created_by)
  values (event_id, coalesce(firm_id, get_current_firm_id()), table_name, record_id, event_type, payload, get_current_employee_id());

  if event_type like '%.deleted' then
    execute format(
      'update %I set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()),
                   updated_at = now(),
                   updated_by = get_current_employee_id()
       where id = $2',
      table_name
    ) using payload, record_id;
    return;
  end if;

  -- Generic sync event recording is intentionally conservative. Domain tables
  -- still use normal Supabase APIs/RLS for authoritative writes unless a table
  -- gets a dedicated sync upsert function.
end;
$$ language plpgsql security definer;

alter table sync_events enable row level security;

drop policy if exists "sync_events_select_office" on sync_events;
drop policy if exists "sync_events_insert_office" on sync_events;

create policy "sync_events_select_office" on sync_events for select
  using (firm_id = get_current_firm_id() and auth.role() = 'authenticated');

create policy "sync_events_insert_office" on sync_events for insert
  with check (firm_id = get_current_firm_id() and auth.role() = 'authenticated');
