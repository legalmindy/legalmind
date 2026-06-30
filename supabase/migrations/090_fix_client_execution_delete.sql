-- Fix client + execution request soft-delete (403 on PATCH / RPC)
-- Root cause: RLS WITH CHECK blocks deleted_at updates; office-admin role mismatch.

-- ─── 1) Stronger office-admin detection ──────────────────────────────────────
create or replace function private.is_office_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select coalesce(
    (select private.get_current_role()) in (
      'super_admin'::public.employee_role_enum,
      'admin'::public.employee_role_enum,
      'firm_manager'::public.employee_role_enum
    ),
    false
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.deleted_at is null
      and p.role::text in ('super_admin', 'admin', 'firm_manager')
  )
  or exists (
    select 1
    from public.employees e
    join public.firm_roles fr on fr.id = e.firm_role_id
    where e.auth_uid = (select auth.uid())
      and e.deleted_at is null
      and e.status = 'active'
      and fr.slug = 'firm_owner'
  );
$$;

create or replace function private.can_delete_clients()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select (select private.is_office_admin())
    or coalesce((select private.has_permission('clients.delete')), false);
$$;

create or replace function private.can_delete_execution_requests()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select (select private.is_office_admin())
    or coalesce((select private.has_permission('clients.delete')), false)
    or coalesce((select private.has_permission('cases.delete')), false);
$$;

grant execute on function private.can_delete_clients() to authenticated, service_role;
grant execute on function private.can_delete_execution_requests() to authenticated, service_role;

-- ─── 2) clients: RLS update policy (allow soft-delete) ───────────────────────
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_update_staff" on public.clients;

create policy "clients_update" on public.clients
  for update
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_firm_subscription_active())
    and deleted_at is null
    and (
      (select private.is_office_admin())
      or (select private.has_permission('clients.edit'))
      or (select private.has_permission('clients.delete'))
    )
  )
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_firm_subscription_active())
  );

grant select, insert, update on public.clients to authenticated;

-- ─── 3) delete_client RPC ────────────────────────────────────────────────────
create or replace function public.delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_firm_id uuid;
  v_affected int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_firm_id := private.get_current_firm_id();
  if v_firm_id is null then
    raise exception 'firm_not_found';
  end if;

  if not (select private.can_delete_clients()) then
    raise exception 'not_authorized';
  end if;

  if exists (
    select 1
    from public.cases c
    where c.client_id = p_client_id
      and c.firm_id = v_firm_id
      and c.deleted_at is null
      and c.status not in ('archived', 'closed')
  ) then
    raise exception 'client_has_active_cases';
  end if;

  update public.clients
  set deleted_at = now(),
      updated_at = now()
  where id = p_client_id
    and firm_id = v_firm_id
    and deleted_at is null;

  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.delete_client(uuid) from public;
grant execute on function public.delete_client(uuid) to authenticated;

-- ─── 4) execution_requests: RLS + delete RPC ───────────────────────────────
drop policy if exists "execution_requests_update" on public.execution_requests;

create policy "execution_requests_update" on public.execution_requests
  for update
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (select private.is_firm_subscription_active())
    and (
      (select private.is_office_admin())
      or (select private.has_permission('clients.edit'))
      or (select private.has_permission('cases.edit'))
      or (select private.get_current_role()) in (
        'assistant'::public.employee_role_enum,
        'lawyer'::public.employee_role_enum
      )
    )
  )
  with check (
    firm_id = (select private.get_current_firm_id())
  );

grant select, insert, update on public.execution_requests to authenticated;

create or replace function public.delete_execution_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_firm_id uuid;
  v_affected int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_firm_id := private.get_current_firm_id();
  if v_firm_id is null then
    raise exception 'firm_not_found';
  end if;

  if not (select private.can_delete_execution_requests()) then
    raise exception 'not_authorized';
  end if;

  update public.execution_requests
  set deleted_at = now(),
      updated_at = now()
  where id = p_request_id
    and firm_id = v_firm_id
    and deleted_at is null;

  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.delete_execution_request(uuid) from public;
grant execute on function public.delete_execution_request(uuid) to authenticated;
