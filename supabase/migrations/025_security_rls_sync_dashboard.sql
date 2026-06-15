-- LegalMind Yemen — Supabase linter fixes, firm-scoped sync, RLS perf, storage hardening
-- Run after 024_subscription_pricing_update.sql

-- ─── 1) Pin search_path on sync helpers flagged by linter ────────────────────
create or replace function public.ensure_sync_table_allowed(table_name text)
returns void
language plpgsql
immutable
set search_path = public
as $$
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
$$;

create or replace function public.sync_apply_event(
  event_id text,
  table_name text,
  record_id uuid,
  firm_id uuid,
  event_type text,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_event uuid;
  v_firm_id uuid;
begin
  perform ensure_sync_table_allowed(table_name);
  v_firm_id := get_current_firm_id();
  if v_firm_id is null then
    raise exception 'No firm context for sync event';
  end if;
  if firm_id is not null and firm_id <> v_firm_id then
    raise exception 'Firm mismatch for sync event';
  end if;

  select id into existing_event from sync_events where client_event_id = event_id;
  if existing_event is not null then
    return;
  end if;

  insert into sync_events(client_event_id, firm_id, table_name, record_id, event_type, payload, created_by)
  values (event_id, v_firm_id, table_name, record_id, event_type, payload, get_current_employee_id());

  if event_type like '%.deleted' then
    if exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = sync_apply_event.table_name
        and c.column_name = 'firm_id'
    ) then
      execute format(
        'update %I set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()),
                     updated_at = now(),
                     updated_by = get_current_employee_id()
         where id = $2 and firm_id = $3',
        table_name
      ) using payload, record_id, v_firm_id;
    else
      if table_name in ('sessions', 'documents') then
        execute format(
          'update %I t set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()),
                       updated_at = now()
           from cases c
           where t.id = $2 and c.id = t.case_id and c.firm_id = $3',
          table_name
        ) using payload, record_id, v_firm_id;
      elsif table_name = 'case_attachments' then
        update case_attachments t
        set deleted_at = coalesce((payload->>'deleted_at')::timestamptz, now())
        from cases c
        where t.id = record_id and c.id = t.case_id and c.firm_id = v_firm_id;
      end if;
    end if;
  end if;
end;
$$;

-- ─── 2) Firm-scoped sync pull (SECURITY DEFINER must not leak cross-tenant rows) ─
drop function if exists public.sync_pull_table(text, text);
create function public.sync_pull_table(table_name text, since_cursor text default null)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sql text;
  v_firm_id uuid;
  has_updated_at boolean;
begin
  perform ensure_sync_table_allowed(table_name);
  v_firm_id := get_current_firm_id();
  if v_firm_id is null then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = sync_pull_table.table_name
      and c.column_name = 'updated_at'
  ) into has_updated_at;

  if table_name = 'firms' then
    return query
    select to_jsonb(t)
    from firms t
    where t.id = v_firm_id
      and (not has_updated_at or since_cursor is null or since_cursor = '' or t.updated_at > since_cursor::timestamptz)
    order by t.updated_at asc nulls last
    limit 500;
    return;
  end if;

  if not has_updated_at and table_name <> 'case_attachments' then
    return;
  end if;

  if table_name in ('employees', 'invitations', 'clients', 'cases', 'notifications') then
    sql := format(
      'select to_jsonb(t) from %I t
       where t.firm_id = $2
         and ($1 is null or $1 = '''' or t.updated_at > $1::timestamptz)
       order by t.updated_at asc
       limit 500',
      table_name
    );
    return query execute sql using since_cursor, v_firm_id;
    return;
  end if;

  if table_name = 'lawyers' then
    return query
    select to_jsonb(l)
    from lawyers l
    join employees e on e.id = l.employee_id and e.firm_id = v_firm_id and e.deleted_at is null
    where since_cursor is null or since_cursor = '' or l.updated_at > since_cursor::timestamptz
    order by l.updated_at asc
    limit 500;
    return;
  end if;

  if table_name = 'sessions' then
    return query
    select to_jsonb(s)
    from sessions s
    join cases c on c.id = s.case_id and c.firm_id = v_firm_id and c.deleted_at is null
    where s.deleted_at is null
      and (since_cursor is null or since_cursor = '' or s.updated_at > since_cursor::timestamptz)
    order by s.updated_at asc
    limit 500;
    return;
  end if;

  if table_name = 'documents' then
    return query
    select to_jsonb(d)
    from documents d
    join cases c on c.id = d.case_id and c.firm_id = v_firm_id and c.deleted_at is null
    where d.deleted_at is null
      and (since_cursor is null or since_cursor = '' or d.updated_at > since_cursor::timestamptz)
    order by d.updated_at asc
    limit 500;
    return;
  end if;

  if table_name = 'case_attachments' then
    return query
    select to_jsonb(a)
    from case_attachments a
    join cases c on c.id = a.case_id and c.firm_id = v_firm_id and c.deleted_at is null
    where a.deleted_at is null
      and (
        not has_updated_at
        or since_cursor is null
        or since_cursor = ''
        or a.updated_at > since_cursor::timestamptz
      )
    order by coalesce(a.updated_at, a.uploaded_at) asc
    limit 500;
    return;
  end if;
end;
$$;

grant execute on function public.sync_pull_table(text, text) to authenticated;
grant execute on function public.sync_apply_event(text, text, uuid, uuid, text, jsonb) to authenticated;

-- Pin search_path on alias helper flagged by linter
create or replace function public.get_current_office_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select get_current_firm_id();
$$;

-- ─── 3) Internal SECURITY DEFINER helpers: revoke PUBLIC, keep internal only ───
do $$
declare
  fn record;
begin
  for fn in
    select *
    from (values
      ('public.get_current_office_id()'),
      ('public.get_current_firm_id()'),
      ('public.get_current_employee_id()'),
      ('public.get_current_role()'),
      ('public.get_current_profile_role()'),
      ('public.is_office_profile_admin()'),
      ('public.is_office_admin()'),
      ('public.is_firm_manager()'),
      ('public.get_current_lawyer_id()'),
      ('public.can_access_case(uuid)'),
      ('public.is_firm_subscription_active()'),
      ('public.ensure_sync_table_allowed(text)'),
      ('public.storage_case_id(text)')
    ) as t(signature)
  loop
    begin
      execute format('revoke all on function %s from public', fn.signature);
      execute format('revoke all on function %s from anon', fn.signature);
      execute format('revoke all on function %s from authenticated', fn.signature);
    exception
      when undefined_function then
        raise notice 'Skipped missing function: %', fn.signature;
    end;
  end loop;
end $$;

-- Registration / lookup RPCs: explicit grants (not via PUBLIC)
do $$
declare
  fn record;
begin
  for fn in
    select *
    from (values
      ('public.get_office_by_code(text)', 'anon, authenticated'),
      ('public.get_office_by_firm_code(text)', 'anon, authenticated'),
      ('public.get_invitation_by_token(text)', 'anon, authenticated'),
      ('public.office_code_exists(text)', 'anon, authenticated'),
      ('public.get_current_profile_context()', 'authenticated'),
      ('public.accept_invitation_for_auth_user(text)', 'authenticated'),
      ('public.create_office_invitation(text, text, text)', 'authenticated'),
      ('public.cancel_office_invitation(uuid)', 'authenticated'),
      ('public.resend_office_invitation(uuid, text)', 'authenticated'),
      ('public.sync_pull_table(text, text)', 'authenticated'),
      ('public.sync_apply_event(text, text, uuid, uuid, text, jsonb)', 'authenticated')
    ) as t(signature, grantees)
  loop
    begin
      execute format('revoke all on function %s from public', fn.signature);
      execute format('grant execute on function %s to %s', fn.signature, fn.grantees);
    exception
      when undefined_function then
        raise notice 'Skipped missing function: %', fn.signature;
    end;
  end loop;
end $$;

-- RLS helpers must remain callable from policies (authenticated only)
do $$
declare
  fn record;
begin
  for fn in
    select *
    from (values
      ('public.get_current_firm_id()'),
      ('public.get_current_employee_id()'),
      ('public.get_current_role()'),
      ('public.get_current_profile_role()'),
      ('public.is_office_profile_admin()'),
      ('public.is_office_admin()'),
      ('public.is_firm_manager()'),
      ('public.get_current_lawyer_id()'),
      ('public.can_access_case(uuid)'),
      ('public.is_firm_subscription_active()'),
      ('public.storage_case_id(text)')
    ) as t(signature)
  loop
    begin
      execute format('grant execute on function %s to authenticated', fn.signature);
    exception
      when undefined_function then null;
    end;
  end loop;
end $$;

-- ─── 4) RLS init-plan perf: wrap auth / helper calls in (select ...) ─────────
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles for select
  using (id = (select auth.uid()) and deleted_at is null);

drop policy if exists "profiles_select_firm" on profiles;
create policy "profiles_select_firm" on profiles for select
  using (firm_id = (select get_current_firm_id()) and deleted_at is null);

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert
  with check (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update
  using (id = (select auth.uid()) and deleted_at is null)
  with check (id = (select auth.uid()) and deleted_at is null);

drop policy if exists "profiles_update_admin_firm" on profiles;
create policy "profiles_update_admin_firm" on profiles for update
  using (firm_id = (select get_current_firm_id()) and (select is_firm_manager()))
  with check (firm_id = (select get_current_firm_id()) and (select is_firm_manager()));

drop policy if exists "employees_select_own" on employees;
create policy "employees_select_own" on employees for select
  using (auth_uid = (select auth.uid()) and deleted_at is null);

drop policy if exists "employees_select_office" on employees;
create policy "employees_select_office" on employees for select
  using (firm_id = (select get_current_firm_id()) and deleted_at is null);

drop policy if exists "sync_events_select_office" on sync_events;
create policy "sync_events_select_office" on sync_events for select
  using (
    firm_id = (select get_current_firm_id())
    and (select auth.role()) = 'authenticated'
  );

drop policy if exists "sync_events_insert_office" on sync_events;
create policy "sync_events_insert_office" on sync_events for insert
  with check (
    firm_id = (select get_current_firm_id())
    and (select auth.role()) = 'authenticated'
  );

drop policy if exists "subscription_requests_select_firm" on subscription_requests;
create policy "subscription_requests_select_firm" on subscription_requests for select
  using (firm_id = (select get_current_firm_id()));

drop policy if exists "subscription_requests_insert_firm" on subscription_requests;
create policy "subscription_requests_insert_firm" on subscription_requests for insert
  with check (
    firm_id = (select get_current_firm_id())
    and submitted_by = (select auth.uid())
  );

-- ─── 5) Storage: subscription-aware case documents + tighten receipts ──────────
drop policy if exists "case_documents_select" on storage.objects;
drop policy if exists "case_documents_insert" on storage.objects;
drop policy if exists "case_documents_update" on storage.objects;
drop policy if exists "case_documents_delete" on storage.objects;

create policy "case_documents_select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'case-documents'
    and (select is_firm_subscription_active())
    and (select can_access_case(storage_case_id(name)))
  );

create policy "case_documents_insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'case-documents'
    and (select is_firm_subscription_active())
    and (select can_access_case(storage_case_id(name)))
  );

create policy "case_documents_update" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'case-documents'
    and (select is_firm_subscription_active())
    and (select can_access_case(storage_case_id(name)))
  )
  with check (
    bucket_id = 'case-documents'
    and (select is_firm_subscription_active())
    and (select can_access_case(storage_case_id(name)))
  );

create policy "case_documents_delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'case-documents'
    and (select is_firm_subscription_active())
    and (select can_access_case(storage_case_id(name)))
    and (select is_office_admin())
  );

drop policy if exists "subscription_receipts_select_firm" on storage.objects;
drop policy if exists "subscription_receipts_insert_firm" on storage.objects;

create policy "subscription_receipts_select_firm" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'subscription-receipts'
    and (storage.foldername(name))[1] = (select get_current_firm_id())::text
  );

create policy "subscription_receipts_insert_firm" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'subscription-receipts'
    and (storage.foldername(name))[1] = (select get_current_firm_id())::text
    and (select is_firm_manager())
  );
