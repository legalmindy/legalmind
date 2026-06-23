-- Export logs, backup registry, document encryption, enhanced audit feed, security stats

-- ─── Document encryption key per firm ────────────────────────────────────────
alter table public.firms
  add column if not exists document_encryption_key bytea;

update public.firms
set document_encryption_key = extensions.gen_random_bytes(32)
where document_encryption_key is null;

alter table public.documents
  add column if not exists is_encrypted boolean not null default false;

create index if not exists idx_documents_encrypted
  on public.documents (is_encrypted)
  where is_encrypted = true and deleted_at is null;

-- ─── Firm backups registry ─────────────────────────────────────────────────
create table if not exists public.firm_backups (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  size_bytes bigint not null default 0,
  file_count integer not null default 0,
  tables_included text[] not null default '{}',
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed')),
  notes text
);

create index if not exists idx_firm_backups_firm_created
  on public.firm_backups (firm_id, created_at desc);

-- ─── Export activity logs ────────────────────────────────────────────────────
create table if not exists public.firm_export_logs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  created_by uuid references public.employees(id) on delete set null,
  export_type text not null,
  export_format text not null,
  filters jsonb not null default '{}'::jsonb,
  record_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_firm_export_logs_firm_created
  on public.firm_export_logs (firm_id, created_at desc);

alter table public.firm_backups enable row level security;
alter table public.firm_export_logs enable row level security;

drop policy if exists firm_backups_select on public.firm_backups;
create policy firm_backups_select on public.firm_backups
  for select to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and private.is_office_admin()
  );

drop policy if exists firm_backups_insert on public.firm_backups;
create policy firm_backups_insert on public.firm_backups
  for insert to authenticated
  with check (
    firm_id = (select private.get_current_firm_id())
    and private.is_office_admin()
  );

drop policy if exists firm_export_logs_select on public.firm_export_logs;
create policy firm_export_logs_select on public.firm_export_logs
  for select to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and private.is_office_admin()
  );

drop policy if exists firm_export_logs_insert on public.firm_export_logs;
create policy firm_export_logs_insert on public.firm_export_logs
  for insert to authenticated
  with check (
    firm_id = (select private.get_current_firm_id())
    and private.is_office_admin()
  );

grant select, insert on public.firm_backups to authenticated;
grant select, insert on public.firm_export_logs to authenticated;

-- ─── Firm document encryption key (office admin only) ───────────────────────
create or replace function public.get_firm_document_encryption_key()
returns text
language plpgsql
stable
security definer
set search_path = public, private, extensions
as $$
declare
  v_key bytea;
begin
  if not private.is_office_admin() then
    raise exception 'غير مصرح';
  end if;

  select f.document_encryption_key
  into v_key
  from public.firms f
  where f.id = private.get_current_firm_id();

  if v_key is null then
    raise exception 'مفتاح التشفير غير متوفر';
  end if;

  return encode(v_key, 'base64');
end;
$$;

revoke all on function public.get_firm_document_encryption_key() from public;
grant execute on function public.get_firm_document_encryption_key() to authenticated;

-- ─── Register backup / export ────────────────────────────────────────────────
create or replace function public.register_firm_backup(
  p_size_bytes bigint,
  p_file_count integer,
  p_tables_included text[] default '{}',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  if not private.is_office_admin() then
    raise exception 'غير مصرح';
  end if;

  insert into public.firm_backups (
    firm_id, created_by, size_bytes, file_count, tables_included, status, notes
  )
  values (
    private.get_current_firm_id(),
    private.get_current_employee_id(),
    coalesce(p_size_bytes, 0),
    coalesce(p_file_count, 0),
    coalesce(p_tables_included, '{}'),
    'completed',
    p_notes
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.register_firm_export(
  p_export_type text,
  p_export_format text,
  p_filters jsonb default '{}'::jsonb,
  p_record_count integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
begin
  if not private.is_office_admin() then
    raise exception 'غير مصرح';
  end if;

  insert into public.firm_export_logs (
    firm_id, created_by, export_type, export_format, filters, record_count
  )
  values (
    private.get_current_firm_id(),
    private.get_current_employee_id(),
    p_export_type,
    p_export_format,
    coalesce(p_filters, '{}'::jsonb),
    coalesce(p_record_count, 0)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_firm_backups(p_limit integer default 50)
returns table (
  id uuid,
  created_at timestamptz,
  size_bytes bigint,
  file_count integer,
  tables_included text[],
  status text,
  notes text,
  created_by_name text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    b.id,
    b.created_at,
    b.size_bytes,
    b.file_count,
    b.tables_included,
    b.status,
    b.notes,
    e.full_name as created_by_name
  from public.firm_backups b
  left join public.employees e on e.id = b.created_by and e.deleted_at is null
  where b.firm_id = private.get_current_firm_id()
    and private.is_office_admin()
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.get_firm_security_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'backup_count', (
      select count(*)::int from public.firm_backups b
      where b.firm_id = private.get_current_firm_id()
    ),
    'last_backup_at', (
      select max(b.created_at) from public.firm_backups b
      where b.firm_id = private.get_current_firm_id()
    ),
    'export_count', (
      select count(*)::int from public.firm_export_logs x
      where x.firm_id = private.get_current_firm_id()
    ),
    'encrypted_files_count', (
      select count(*)::int
      from public.documents d
      join public.cases c on c.id = d.case_id
      where c.firm_id = private.get_current_firm_id()
        and d.is_encrypted = true
        and d.deleted_at is null
    ),
    'audit_log_count', (
      select count(*)::int from public.audit_logs a
      where a.firm_id = private.get_current_firm_id()
    )
  )
  where private.is_office_admin();
$$;

revoke all on function public.register_firm_backup(bigint, integer, text[], text) from public;
grant execute on function public.register_firm_backup(bigint, integer, text[], text) to authenticated;

revoke all on function public.register_firm_export(text, text, jsonb, integer) from public;
grant execute on function public.register_firm_export(text, text, jsonb, integer) to authenticated;

revoke all on function public.list_firm_backups(integer) from public;
grant execute on function public.list_firm_backups(integer) to authenticated;

revoke all on function public.get_firm_security_stats() from public;
grant execute on function public.get_firm_security_stats() to authenticated;

-- ─── Enhanced activity log feed ─────────────────────────────────────────────
drop function if exists public.list_firm_activity_logs(integer, text);

create or replace function public.list_firm_activity_logs(
  p_limit integer default 200,
  p_table_filter text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null
)
returns table (
  id uuid,
  record_id uuid,
  created_at timestamptz,
  operation text,
  table_name text,
  action_type text,
  entity_summary text,
  employee_name text,
  employee_id uuid,
  ip_address inet,
  changes jsonb
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    a.id,
    a.record_id,
    a.created_at,
    a.operation,
    a.table_name,
    a.action_type,
    a.entity_summary,
    e.full_name as employee_name,
    a.changed_by as employee_id,
    a.ip_address,
    a.changes
  from public.audit_logs a
  left join public.employees e on e.id = a.changed_by and e.deleted_at is null
  where private.is_office_admin()
    and (
      a.firm_id = private.get_current_firm_id()
      or (
        a.firm_id is null
        and a.changed_by is not null
        and e.firm_id = private.get_current_firm_id()
      )
    )
    and (p_table_filter is null or p_table_filter = '' or a.table_name = p_table_filter)
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at <= p_to)
    and (
      p_search is null or p_search = ''
      or coalesce(a.entity_summary, '') ilike ('%' || p_search || '%')
      or coalesce(e.full_name, '') ilike ('%' || p_search || '%')
      or a.table_name ilike ('%' || p_search || '%')
    )
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.list_firm_activity_logs(integer, text, timestamptz, timestamptz, text) from public;
grant execute on function public.list_firm_activity_logs(integer, text, timestamptz, timestamptz, text) to authenticated;

-- ─── Firm isolation hardening: block cross-firm document reads ───────────────
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.cases c
      where c.id = documents.case_id
        and c.firm_id = (select private.get_current_firm_id())
        and c.deleted_at is null
        and private.can_access_case(c.id)
    )
  );
