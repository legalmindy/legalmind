-- LegalMind Yemen — Supabase linter hardening (Security + Performance)
-- Run after 026_fix_trial_plan_and_free_month.sql
--
-- Fixes:
--   • Signed-In Users Can Execute SECURITY DEFINER (move helpers to private schema)
--   • Auth RLS Initialization Plan ((select ...) + private helpers)
--   • Multiple Permissive Policies (consolidate to one policy per action)
--   • Duplicate index on firms.firm_code
--
-- Note: Enable "Leaked password protection" in Supabase Dashboard:
--   Authentication → Settings → Password Security → Enable leaked password protection

-- ─── 1) Private schema (not exposed via PostgREST API) ───────────────────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to postgres, service_role, authenticated;

-- ─── 2) Internal helpers (SECURITY DEFINER, private schema only) ─────────────

create or replace function private.get_current_firm_id()
returns uuid
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(
    (select firm_id from public.profiles where id = (select auth.uid()) and deleted_at is null limit 1),
    (select firm_id from public.employees where auth_uid = (select auth.uid()) and deleted_at is null limit 1)
  );
$$;

create or replace function private.get_current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(
    (select employee_id from public.profiles where id = (select auth.uid()) and deleted_at is null limit 1),
    (select id from public.employees where auth_uid = (select auth.uid()) and deleted_at is null limit 1)
  );
$$;

create or replace function private.get_current_profile_role()
returns text
language sql
stable
security definer
set search_path = private, public
as $$
  select case role::text
    when 'firm_manager' then 'admin'
    when 'super_admin' then 'admin'
    else role::text
  end
  from public.profiles
  where id = (select auth.uid()) and deleted_at is null
  limit 1;
$$;

create or replace function private.get_current_role()
returns public.employee_role_enum
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(
    (
      select e.role
      from public.profiles p
      join public.employees e on e.id = p.employee_id and e.deleted_at is null
      where p.id = (select auth.uid()) and p.deleted_at is null
      limit 1
    ),
    (
      select e.role
      from public.employees e
      where e.auth_uid = (select auth.uid()) and e.deleted_at is null
      limit 1
    ),
    (
      select case p.role::text
        when 'lawyer' then 'lawyer'::public.employee_role_enum
        when 'assistant' then 'assistant'::public.employee_role_enum
        when 'admin' then 'firm_manager'::public.employee_role_enum
        else null::public.employee_role_enum
      end
      from public.profiles p
      where p.id = (select auth.uid()) and p.deleted_at is null
      limit 1
    )
  );
$$;

create or replace function private.get_current_lawyer_id()
returns uuid
language sql
stable
security definer
set search_path = private, public
as $$
  select l.id
  from public.lawyers l
  where l.employee_id = private.get_current_employee_id()
  limit 1;
$$;

create or replace function private.is_office_profile_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(private.get_current_profile_role() = 'admin', false);
$$;

create or replace function private.is_office_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(private.get_current_role() in ('super_admin','admin','firm_manager'), false);
$$;

create or replace function private.is_firm_manager()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(private.is_office_profile_admin() or private.is_office_admin(), false);
$$;

create or replace function private.is_current_user_office_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select private.is_firm_manager();
$$;

create or replace function private.is_firm_subscription_active()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(
    (
      select
        not f.is_locked
        and f.subscription_status in ('trial', 'active')
        and (f.subscription_expires_at is null or f.subscription_expires_at > now())
      from public.firms f
      where f.id = private.get_current_firm_id()
        and f.deleted_at is null
    ),
    false
  );
$$;

create or replace function private.can_access_case(target_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case_id
      and c.firm_id = private.get_current_firm_id()
      and c.deleted_at is null
      and (
        private.is_office_admin()
        or private.get_current_role() = 'assistant'
        or (
          private.get_current_role() = 'lawyer'
          and c.assigned_lawyer_id is not null
          and c.assigned_lawyer_id = private.get_current_lawyer_id()
        )
      )
  );
$$;

create or replace function private.storage_case_id(object_name text)
returns uuid
language sql
immutable
security invoker
set search_path = private, public
as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$;

create or replace function private.insert_audit_log()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
declare
  changes jsonb;
  emp_id uuid;
begin
  emp_id := private.get_current_employee_id();
  if tg_op = 'INSERT' then changes := row_to_json(new)::jsonb;
  elsif tg_op = 'UPDATE' then changes := jsonb_build_object('old', row_to_json(old), 'new', row_to_json(new));
  elsif tg_op = 'DELETE' then changes := row_to_json(old)::jsonb;
  end if;
  insert into public.audit_logs(table_name, record_id, operation, changed_by, changes)
  values (tg_table_name, coalesce(new.id, old.id), tg_op, emp_id, changes);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.ensure_sync_table_allowed(table_name text)
returns void
language plpgsql
immutable
set search_path = private, public
as $$
begin
  if table_name not in (
    'firms','employees','invitations','clients','cases',
    'sessions','documents','case_attachments','lawyers','notifications'
  ) then
    raise exception 'Unsupported sync table: %', table_name;
  end if;
end;
$$;

-- RLS policies need EXECUTE on private helpers (not exposed as public RPC)
do $$
declare sig text;
begin
  foreach sig in array array[
    'private.get_current_firm_id()',
    'private.get_current_employee_id()',
    'private.get_current_profile_role()',
    'private.get_current_role()',
    'private.get_current_lawyer_id()',
    'private.is_office_profile_admin()',
    'private.is_office_admin()',
    'private.is_firm_manager()',
    'private.is_current_user_office_admin()',
    'private.is_firm_subscription_active()',
    'private.can_access_case(uuid)',
    'private.storage_case_id(text)'
  ]
  loop
    execute format('grant execute on function %s to authenticated', sig);
  end loop;
end $$;

-- ─── 3) Audit triggers → private.insert_audit_log ────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['clients','cases','sessions','documents','case_attachments','employees']
  loop
    execute format('drop trigger if exists audit_%s on public.%I', t, t);
    execute format(
      'create trigger audit_%s after insert or update or delete on public.%I
       for each row execute function private.insert_audit_log()',
      t, t
    );
  end loop;
end $$;

-- ─── 4) Drop duplicate firm_code indexes (keep constraint-backed indexes) ────
do $$
declare idx record;
begin
  for idx in
    select ic.relname as indexname
    from pg_index x
    join pg_class ic on ic.oid = x.indexrelid
    join pg_class tc on tc.oid = x.indrelid
    join pg_namespace n on n.oid = tc.relnamespace
    where n.nspname = 'public'
      and tc.relname = 'firms'
      and pg_get_indexdef(x.indexrelid) ilike '%firm_code%'
      and not exists (
        select 1 from pg_constraint c where c.conindid = x.indexrelid
      )
  loop
    execute format('drop index if exists public.%I', idx.indexname);
  end loop;
end $$;

-- Partial lookup index only if no unique constraint already covers firm_code
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'firms'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%firm_code%'
  ) then
    execute '
      create index if not exists idx_firms_code_active
        on public.firms (firm_code)
        where deleted_at is null and firm_code is not null
    ';
  end if;
end $$;

-- ─── 5) Drop ALL legacy / duplicate RLS policies ───────────────────────────
do $$
declare pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'firms','profiles','employees','invitations','lawyers',
        'clients','cases','audit_logs','error_logs','sync_events',
        'subscription_requests'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- ─── 6) Consolidated RLS (one permissive policy per action) ─────────────────

-- firms
create policy "firms_select" on public.firms for select
  using (
    id in (
      select firm_id from public.profiles
      where id = (select auth.uid()) and deleted_at is null
      union
      select firm_id from public.employees
      where auth_uid = (select auth.uid()) and deleted_at is null
    )
  );

create policy "firms_update" on public.firms for update
  using (id = (select private.get_current_firm_id()) and (select private.is_firm_manager()))
  with check (id = (select private.get_current_firm_id()) and (select private.is_firm_manager()));

-- profiles
create policy "profiles_select" on public.profiles for select
  using (
    deleted_at is null
    and (
      id = (select auth.uid())
      or firm_id = (select private.get_current_firm_id())
    )
  );

create policy "profiles_insert" on public.profiles for insert
  with check (id = (select auth.uid()));

create policy "profiles_update" on public.profiles for update
  using (
    deleted_at is null
    and (
      id = (select auth.uid())
      or (firm_id = (select private.get_current_firm_id()) and (select private.is_firm_manager()))
    )
  )
  with check (
    id = (select auth.uid())
    or (firm_id = (select private.get_current_firm_id()) and (select private.is_firm_manager()))
  );

-- employees
create policy "employees_select" on public.employees for select
  using (
    deleted_at is null
    and (
      auth_uid = (select auth.uid())
      or firm_id = (select private.get_current_firm_id())
    )
  );

create policy "employees_insert" on public.employees for insert
  with check (
    auth_uid = (select auth.uid())
    or (
      firm_id = (select private.get_current_firm_id())
      and (select private.is_firm_manager())
    )
  );

create policy "employees_update" on public.employees for update
  using (
    deleted_at is null
    and (
      auth_uid = (select auth.uid())
      or (
        firm_id = (select private.get_current_firm_id())
        and (select private.is_firm_manager())
      )
    )
  )
  with check (
    auth_uid = (select auth.uid())
    or (
      firm_id = (select private.get_current_firm_id())
      and (select private.is_firm_manager())
    )
  );

create policy "employees_delete" on public.employees for delete
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.get_current_role()) in ('super_admin','admin','firm_manager')
  );

-- invitations
create policy "invitations_select" on public.invitations for select
  using (firm_id = (select private.get_current_firm_id()) and (select private.is_firm_manager()));

create policy "invitations_insert" on public.invitations for insert
  with check (firm_id = (select private.get_current_firm_id()) and (select private.is_firm_manager()));

create policy "invitations_update" on public.invitations for update
  using (firm_id = (select private.get_current_firm_id()) and (select private.is_firm_manager()))
  with check (firm_id = (select private.get_current_firm_id()) and (select private.is_firm_manager()));

-- lawyers
create policy "lawyers_select" on public.lawyers for select
  using (
    exists (
      select 1 from public.employees e
      where e.id = lawyers.employee_id
        and e.firm_id = (select private.get_current_firm_id())
        and e.deleted_at is null
    )
  );

create policy "lawyers_insert" on public.lawyers for insert
  with check (
    exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.auth_uid = (select auth.uid())
        and e.deleted_at is null
    )
    or exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.firm_id = (select private.get_current_firm_id())
        and (select private.is_office_admin())
    )
  );

create policy "lawyers_update" on public.lawyers for update
  using (
    exists (
      select 1 from public.employees e
      where e.id = lawyers.employee_id
        and e.firm_id = (select private.get_current_firm_id())
        and (select private.is_office_admin())
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.firm_id = (select private.get_current_firm_id())
        and (select private.is_office_admin())
    )
  );

-- clients
create policy "clients_select" on public.clients for select
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and deleted_at is null
  );

create policy "clients_insert" on public.clients for insert
  with check (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and (select private.get_current_role()) in ('super_admin','admin','firm_manager','assistant')
  );

create policy "clients_update" on public.clients for update
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
  )
  with check (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
  );

-- cases (refresh with private helpers + subscription)
drop policy if exists "cases_select_role_scoped" on public.cases;
drop policy if exists "cases_insert_staff" on public.cases;
drop policy if exists "cases_update_role_scoped" on public.cases;
drop policy if exists "cases_delete_admin" on public.cases;

create policy "cases_select" on public.cases for select
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (
      (select private.is_office_admin())
      or (select private.get_current_role()) = 'assistant'
      or (
        (select private.get_current_role()) = 'lawyer'
        and assigned_lawyer_id is not null
        and assigned_lawyer_id = (select private.get_current_lawyer_id())
      )
    )
  );

create policy "cases_insert" on public.cases for insert
  with check (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and (
      (select private.get_current_role()) in ('super_admin','admin','firm_manager','assistant')
      or (
        (select private.get_current_role()) = 'lawyer'
        and (assigned_lawyer_id is null or assigned_lawyer_id = (select private.get_current_lawyer_id()))
      )
    )
  );

create policy "cases_update" on public.cases for update
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and (
      (select private.is_office_admin())
      or (select private.get_current_role()) = 'assistant'
      or (
        (select private.get_current_role()) = 'lawyer'
        and assigned_lawyer_id is not null
        and assigned_lawyer_id = (select private.get_current_lawyer_id())
      )
    )
  )
  with check (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
  );

create policy "cases_delete" on public.cases for delete
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  );

-- audit / error logs
create policy "audit_logs_select" on public.audit_logs for select
  using ((select private.is_office_admin()));

create policy "error_logs_insert" on public.error_logs for insert
  with check ((select auth.role()) = 'authenticated');

create policy "error_logs_select" on public.error_logs for select
  using ((select private.is_office_admin()));

-- sync_events
create policy "sync_events_select" on public.sync_events for select
  using (
    firm_id = (select private.get_current_firm_id())
    and (select auth.role()) = 'authenticated'
  );

create policy "sync_events_insert" on public.sync_events for insert
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select auth.role()) = 'authenticated'
  );

-- subscription_requests
create policy "subscription_requests_select" on public.subscription_requests for select
  using (firm_id = (select private.get_current_firm_id()));

create policy "subscription_requests_insert" on public.subscription_requests for insert
  with check (
    firm_id = (select private.get_current_firm_id())
    and submitted_by = (select auth.uid())
  );

-- ─── 7) Storage policies (private.storage_case_id) ───────────────────────────
drop policy if exists "case_documents_select" on storage.objects;
drop policy if exists "case_documents_insert" on storage.objects;
drop policy if exists "case_documents_update" on storage.objects;
drop policy if exists "case_documents_delete" on storage.objects;
drop policy if exists "storage_select_case_access" on storage.objects;
drop policy if exists "storage_insert_case_access" on storage.objects;
drop policy if exists "storage_update_case_access" on storage.objects;
drop policy if exists "storage_delete_admin" on storage.objects;

create policy "case_documents_select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'case-documents'
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(private.storage_case_id(name)))
  );

create policy "case_documents_insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'case-documents'
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(private.storage_case_id(name)))
  );

create policy "case_documents_update" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'case-documents'
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(private.storage_case_id(name)))
  )
  with check (
    bucket_id = 'case-documents'
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(private.storage_case_id(name)))
  );

create policy "case_documents_delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'case-documents'
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(private.storage_case_id(name)))
    and (select private.is_office_admin())
  );

drop policy if exists "subscription_receipts_select_firm" on storage.objects;
drop policy if exists "subscription_receipts_insert_firm" on storage.objects;

create policy "subscription_receipts_select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'subscription-receipts'
    and (storage.foldername(name))[1] = (select private.get_current_firm_id())::text
  );

create policy "subscription_receipts_insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'subscription-receipts'
    and (storage.foldername(name))[1] = (select private.get_current_firm_id())::text
    and (select private.is_firm_manager())
  );

-- ─── 8) Sync RPC — SECURITY INVOKER (RLS enforced, no DEFINER lint) ──────────
drop function if exists public.sync_pull_table(text, text);

create function public.sync_pull_table(table_name text, since_cursor text default null)
returns setof jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  sql text;
  v_firm_id uuid;
  has_updated_at boolean;
begin
  perform private.ensure_sync_table_allowed(table_name);
  v_firm_id := private.get_current_firm_id();
  if v_firm_id is null then return; end if;

  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = sync_pull_table.table_name and c.column_name = 'updated_at'
  ) into has_updated_at;

  if table_name = 'firms' then
    return query
    select to_jsonb(t) from public.firms t
    where t.id = v_firm_id
      and (not has_updated_at or since_cursor is null or since_cursor = '' or t.updated_at > since_cursor::timestamptz)
    order by t.updated_at asc nulls last limit 500;
    return;
  end if;

  if not has_updated_at and table_name <> 'case_attachments' then return; end if;

  if table_name in ('employees','invitations','clients','cases','notifications') then
    sql := format(
      'select to_jsonb(t) from public.%I t
       where t.firm_id = $2
         and ($1 is null or $1 = '''' or t.updated_at > $1::timestamptz)
       order by t.updated_at asc limit 500', table_name);
    return query execute sql using since_cursor, v_firm_id;
  elsif table_name = 'lawyers' then
    return query
    select to_jsonb(l) from public.lawyers l
    join public.employees e on e.id = l.employee_id and e.firm_id = v_firm_id and e.deleted_at is null
    where since_cursor is null or since_cursor = '' or l.updated_at > since_cursor::timestamptz
    order by l.updated_at asc limit 500;
  elsif table_name = 'sessions' then
    return query
    select to_jsonb(s) from public.sessions s
    join public.cases c on c.id = s.case_id and c.firm_id = v_firm_id and c.deleted_at is null
    where s.deleted_at is null
      and (since_cursor is null or since_cursor = '' or s.updated_at > since_cursor::timestamptz)
    order by s.updated_at asc limit 500;
  elsif table_name = 'documents' then
    return query
    select to_jsonb(d) from public.documents d
    join public.cases c on c.id = d.case_id and c.firm_id = v_firm_id and c.deleted_at is null
    where d.deleted_at is null
      and (since_cursor is null or since_cursor = '' or d.updated_at > since_cursor::timestamptz)
    order by d.updated_at asc limit 500;
  elsif table_name = 'case_attachments' then
    return query
    select to_jsonb(a) from public.case_attachments a
    join public.cases c on c.id = a.case_id and c.firm_id = v_firm_id and c.deleted_at is null
    where a.deleted_at is null
      and (not has_updated_at or since_cursor is null or since_cursor = '' or a.updated_at > since_cursor::timestamptz)
    order by coalesce(a.updated_at, a.uploaded_at) asc limit 500;
  end if;
end;
$$;

create or replace function public.sync_apply_event(
  event_id text, table_name text, record_id uuid,
  firm_id uuid, event_type text, payload jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  existing_event uuid;
  v_firm_id uuid;
begin
  perform private.ensure_sync_table_allowed(table_name);
  v_firm_id := private.get_current_firm_id();
  if v_firm_id is null then raise exception 'No firm context'; end if;
  if firm_id is not null and firm_id <> v_firm_id then raise exception 'Firm mismatch'; end if;

  select id into existing_event from public.sync_events where client_event_id = event_id;
  if existing_event is not null then return; end if;

  insert into public.sync_events(client_event_id, firm_id, table_name, record_id, event_type, payload, created_by)
  values (event_id, v_firm_id, table_name, record_id, event_type, payload, private.get_current_employee_id());

  if event_type like '%.deleted' then
    if exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = sync_apply_event.table_name and c.column_name = 'firm_id'
    ) then
      execute format(
        'update public.%I set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()), updated_at = now()
         where id = $2 and firm_id = $3', table_name
      ) using payload, record_id, v_firm_id;
    elsif table_name in ('sessions','documents') then
      execute format(
        'update public.%I t set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()), updated_at = now()
         from public.cases c where t.id = $2 and c.id = t.case_id and c.firm_id = $3', table_name
      ) using payload, record_id, v_firm_id;
    end if;
  end if;
end;
$$;

-- ─── 9) Public RPC helpers (use private.* internally) ────────────────────────

create or replace function public.get_current_profile_context()
returns table (
  profile_id uuid, firm_id uuid, employee_id uuid,
  full_name text, email text, role text, firm_name text, firm_code text
)
language plpgsql
stable
security invoker
set search_path = public, private
as $$
begin
  return query
  select p.id, p.firm_id, p.employee_id, p.full_name, p.email, p.role::text, f.name, f.firm_code::text
  from public.profiles p
  left join public.firms f on f.id = p.firm_id
  where p.id = (select auth.uid()) and p.deleted_at is null;
end;
$$;

-- Update invitation/office RPCs to use private helpers
create or replace function public.create_office_invitation(
  invite_email text, invite_role text, app_origin text default null
)
returns table (id uuid, email text, role text, status text, expires_at timestamptz, invite_url text)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  raw_token text; hashed_token text; new_invitation public.invitations%rowtype; base_url text;
begin
  perform public.expire_old_invitations();
  if not (select private.is_firm_manager()) then
    raise exception 'Only firm admins can create invitations';
  end if;
  if invite_role not in ('lawyer','assistant') then raise exception 'Invalid role'; end if;
  raw_token := encode(gen_random_bytes(32), 'hex');
  hashed_token := public.invitation_hash(raw_token);
  base_url := coalesce(nullif(trim(app_origin), ''), 'https://app.com');
  insert into public.invitations (firm_id, email, role, status, token_hash, invited_by, expires_at, invite_url)
  values (
    private.get_current_firm_id(), lower(trim(invite_email)), invite_role::public.employee_role_enum,
    'pending', hashed_token, private.get_current_employee_id(), now() + interval '7 days',
    base_url || '/invite/' || raw_token
  ) returning * into new_invitation;
  return query select new_invitation.id, new_invitation.email, new_invitation.role::text,
    new_invitation.status, new_invitation.expires_at, new_invitation.invite_url;
end;
$$;

create or replace function public.resend_office_invitation(invitation_id uuid, app_origin text default null)
returns table (id uuid, email text, role text, status text, expires_at timestamptz, invite_url text)
language plpgsql
security definer
set search_path = public, private
as $$
declare raw_token text; inv public.invitations%rowtype; base_url text;
begin
  if not (select private.is_firm_manager()) then raise exception 'Unauthorized'; end if;
  raw_token := encode(gen_random_bytes(32), 'hex');
  base_url := coalesce(nullif(trim(app_origin), ''), 'https://app.com');
  update public.invitations
  set token_hash = public.invitation_hash(raw_token), status = 'pending',
      expires_at = now() + interval '7 days', invite_url = base_url || '/invite/' || raw_token
  where id = invitation_id and firm_id = private.get_current_firm_id()
  returning * into inv;
  return query select inv.id, inv.email, inv.role::text, inv.status, inv.expires_at, inv.invite_url;
end;
$$;

create or replace function public.cancel_office_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not (select private.is_firm_manager()) then
    raise exception 'Only firm admins can cancel invitations';
  end if;
  update public.invitations
  set status = 'cancelled', cancelled_at = now()
  where id = invitation_id
    and firm_id = private.get_current_firm_id()
    and status in ('pending','expired');
end;
$$;

-- ─── 10) Update triggers/functions before dropping public helpers ────────────
create or replace function public.bump_sync_metadata()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  new.sync_version := coalesce(old.sync_version, 0) + 1;
  new.updated_by := private.get_current_employee_id();
  if tg_op = 'UPDATE' and (new.updated_at is null or new.updated_at = old.updated_at) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ─── 11) Revoke public internal helpers (moved to private) ───────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.get_current_firm_id()',
    'public.get_current_employee_id()',
    'public.get_current_role()',
    'public.get_current_profile_role()',
    'public.get_current_office_id()',
    'public.get_current_lawyer_id()',
    'public.is_office_profile_admin()',
    'public.is_office_admin()',
    'public.is_firm_manager()',
    'public.is_current_user_office_admin()',
    'public.is_firm_subscription_active()',
    'public.can_access_case(uuid)',
    'public.insert_audit_log()',
    'public.storage_case_id(text)',
    'public.ensure_sync_table_allowed(text)'
  ]
  loop
    begin
      execute format('drop function if exists %s cascade', fn);
    exception when others then
      raise notice 'Skipped drop: %', fn;
    end;
  end loop;
end $$;

-- Explicit grants for intentional public RPCs only
revoke all on function public.sync_pull_table(text, text) from public;
revoke all on function public.sync_apply_event(text, text, uuid, uuid, text, jsonb) from public;
grant execute on function public.sync_pull_table(text, text) to authenticated;
grant execute on function public.sync_apply_event(text, text, uuid, uuid, text, jsonb) to authenticated;

revoke all on function public.get_current_profile_context() from public;
grant execute on function public.get_current_profile_context() to authenticated;

revoke all on function public.create_office_invitation(text, text, text) from public;
grant execute on function public.create_office_invitation(text, text, text) to authenticated;

revoke all on function public.resend_office_invitation(uuid, text) from public;
grant execute on function public.resend_office_invitation(uuid, text) to authenticated;

revoke all on function public.cancel_office_invitation(uuid) from public;
grant execute on function public.cancel_office_invitation(uuid) to authenticated;

revoke all on function public.get_office_by_code(text) from public;
revoke all on function public.get_office_by_firm_code(text) from public;
revoke all on function public.get_invitation_by_token(text) from public;
revoke all on function public.office_code_exists(text) from public;
revoke all on function public.is_email_available_for_registration(text) from public;
grant execute on function public.get_office_by_code(text) to anon, authenticated;
grant execute on function public.get_office_by_firm_code(text) to anon, authenticated;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
grant execute on function public.office_code_exists(text) to anon, authenticated;
grant execute on function public.is_email_available_for_registration(text) to anon, authenticated;

-- ─── 12) Optional tables (threads/messages) — schema-aware, no assumptions ───
do $$
declare
  pol record;
  threads_has_firm_id boolean := false;
  threads_has_case_id boolean := false;
  threads_has_office_id boolean := false;
  threads_has_created_by boolean := false;
  messages_has_firm_id boolean := false;
  messages_has_thread_id boolean := false;
  messages_has_case_id boolean := false;
  messages_has_sender_id boolean := false;
  messages_has_user_id boolean := false;
  thread_scope_expr text := null;
  message_scope_expr text := null;
  message_insert_expr text := null;
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'threads') then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'threads' and column_name = 'firm_id'
    ) into threads_has_firm_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'threads' and column_name = 'case_id'
    ) into threads_has_case_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'threads' and column_name = 'office_id'
    ) into threads_has_office_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'threads' and column_name = 'created_by'
    ) into threads_has_created_by;

    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'threads'
    loop
      execute format('drop policy if exists %I on public.threads', pol.policyname);
    end loop;

    if threads_has_firm_id then
      thread_scope_expr := 'firm_id = (select private.get_current_firm_id())';
    elsif threads_has_office_id then
      thread_scope_expr := 'office_id = (select private.get_current_firm_id())';
    elsif threads_has_case_id then
      thread_scope_expr := format(
        'exists (
          select 1 from public.cases c
          where c.id = threads.case_id
            and c.firm_id = (select private.get_current_firm_id())
            and c.deleted_at is null
        )'
      );
    elsif threads_has_created_by then
      thread_scope_expr := 'created_by = (select auth.uid())';
    else
      raise notice 'threads: skipped RLS recreate — no firm/case/office scope column found';
      thread_scope_expr := null;
    end if;

    if thread_scope_expr is not null then
      execute format(
        'create policy "threads_select" on public.threads for select using (%s)',
        thread_scope_expr
      );
      execute format(
        'create policy "threads_insert" on public.threads for insert with check (%s)',
        thread_scope_expr
      );
      execute format(
        'create policy "threads_update" on public.threads for update using (%1$s) with check (%1$s)',
        thread_scope_expr
      );
    end if;
  end if;

  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'messages') then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'firm_id'
    ) into messages_has_firm_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'thread_id'
    ) into messages_has_thread_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'case_id'
    ) into messages_has_case_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'sender_id'
    ) into messages_has_sender_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'user_id'
    ) into messages_has_user_id;

    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'messages'
    loop
      execute format('drop policy if exists %I on public.messages', pol.policyname);
    end loop;

    if messages_has_firm_id then
      message_scope_expr := 'firm_id = (select private.get_current_firm_id())';
    elsif messages_has_case_id then
      message_scope_expr := format(
        'exists (
          select 1 from public.cases c
          where c.id = messages.case_id
            and c.firm_id = (select private.get_current_firm_id())
            and c.deleted_at is null
        )'
      );
    elsif messages_has_thread_id and thread_scope_expr is not null then
      if threads_has_firm_id then
        message_scope_expr := format(
          'exists (
            select 1 from public.threads t
            where t.id = messages.thread_id
              and t.firm_id = (select private.get_current_firm_id())
          )'
        );
      elsif threads_has_office_id then
        message_scope_expr := format(
          'exists (
            select 1 from public.threads t
            where t.id = messages.thread_id
              and t.office_id = (select private.get_current_firm_id())
          )'
        );
      elsif threads_has_case_id then
        message_scope_expr := format(
          'exists (
            select 1 from public.threads t
            join public.cases c on c.id = t.case_id and c.deleted_at is null
            where t.id = messages.thread_id
              and c.firm_id = (select private.get_current_firm_id())
          )'
        );
      elsif threads_has_created_by then
        message_scope_expr := format(
          'exists (
            select 1 from public.threads t
            where t.id = messages.thread_id
              and t.created_by = (select auth.uid())
          )'
        );
      end if;
    elsif messages_has_sender_id then
      message_scope_expr := 'sender_id = (select auth.uid())';
    elsif messages_has_user_id then
      message_scope_expr := 'user_id = (select auth.uid())';
    else
      raise notice 'messages: skipped RLS recreate — no tenant scope column found';
      message_scope_expr := null;
    end if;

    if message_scope_expr is not null then
      message_insert_expr := message_scope_expr;
      message_insert_expr := replace(message_insert_expr, 'messages.thread_id', 'thread_id');
      message_insert_expr := replace(message_insert_expr, 'messages.case_id', 'case_id');
      execute format(
        'create policy "messages_select" on public.messages for select using (%s)',
        message_scope_expr
      );
      execute format(
        'create policy "messages_insert" on public.messages for insert with check (%s)',
        message_insert_expr
      );
    end if;
  end if;
end $$;

-- ─── 13) Sessions/documents/notifications refresh (private helpers) ──────────
drop policy if exists "sessions_select_case_access" on public.sessions;
drop policy if exists "sessions_insert_staff" on public.sessions;
drop policy if exists "sessions_update_staff" on public.sessions;
drop policy if exists "sessions_delete_admin" on public.sessions;
drop policy if exists "documents_select_case_access" on public.documents;
drop policy if exists "documents_insert_case_access" on public.documents;
drop policy if exists "documents_update_case_access" on public.documents;
drop policy if exists "documents_delete_admin" on public.documents;
drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;
drop policy if exists "notifications_insert_staff" on public.notifications;

create policy "sessions_select" on public.sessions for select
  using (
    deleted_at is null
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(case_id))
  );

create policy "sessions_insert" on public.sessions for insert
  with check (
    (select private.is_firm_subscription_active())
    and (select private.can_access_case(case_id))
    and (select private.get_current_role()) in ('super_admin','admin','firm_manager','assistant','lawyer')
  );

create policy "sessions_update" on public.sessions for update
  using ((select private.is_firm_subscription_active()) and (select private.can_access_case(case_id)))
  with check ((select private.is_firm_subscription_active()) and (select private.can_access_case(case_id)));

create policy "sessions_delete" on public.sessions for delete
  using ((select private.can_access_case(case_id)) and (select private.is_office_admin()));

create policy "documents_select" on public.documents for select
  using (
    deleted_at is null
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(case_id))
  );

create policy "documents_insert" on public.documents for insert
  with check ((select private.is_firm_subscription_active()) and (select private.can_access_case(case_id)));

create policy "documents_update" on public.documents for update
  using ((select private.is_firm_subscription_active()) and (select private.can_access_case(case_id)))
  with check ((select private.is_firm_subscription_active()) and (select private.can_access_case(case_id)));

create policy "documents_delete" on public.documents for delete
  using ((select private.can_access_case(case_id)) and (select private.is_office_admin()));

create policy "notifications_select" on public.notifications for select
  using (
    firm_id = (select private.get_current_firm_id())
    and (employee_id is null or employee_id = (select private.get_current_employee_id()))
  );

create policy "notifications_update" on public.notifications for update
  using (
    firm_id = (select private.get_current_firm_id())
    and (employee_id is null or employee_id = (select private.get_current_employee_id()))
  );

create policy "notifications_insert" on public.notifications for insert
  with check (firm_id = (select private.get_current_firm_id()));

-- case_attachments
drop policy if exists "attachments_select_case_access" on public.case_attachments;
drop policy if exists "attachments_insert_case_access" on public.case_attachments;
drop policy if exists "attachments_update_case_access" on public.case_attachments;
drop policy if exists "attachments_delete_admin" on public.case_attachments;

create policy "case_attachments_select" on public.case_attachments for select
  using (deleted_at is null and (select private.can_access_case(case_id)));

create policy "case_attachments_insert" on public.case_attachments for insert
  with check ((select private.can_access_case(case_id)));

create policy "case_attachments_update" on public.case_attachments for update
  using ((select private.can_access_case(case_id)))
  with check ((select private.can_access_case(case_id)));

create policy "case_attachments_delete" on public.case_attachments for delete
  using ((select private.can_access_case(case_id)) and (select private.is_office_admin()));
