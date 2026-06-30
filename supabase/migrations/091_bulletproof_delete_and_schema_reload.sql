-- 091: Bulletproof delete auth + PostgREST schema reload + office-owner repair on delete

notify pgrst, 'reload schema';

-- Repair office owner role/permissions before permission checks
create or replace function private.repair_current_office_owner_access(p_firm_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  if p_firm_id is null or auth.uid() is null then
    return;
  end if;

  update public.employees e
  set
    firm_role_id = fr.id,
    individual_permissions = coalesce(nullif(e.individual_permissions, '{}'::jsonb), fr.permissions),
    role = case
      when e.role in ('firm_manager', 'admin', 'super_admin') then e.role
      else 'firm_manager'::public.employee_role_enum
    end,
    status = 'active',
    updated_at = now()
  from public.firm_roles fr
  where e.auth_uid = auth.uid()
    and e.firm_id = p_firm_id
    and e.deleted_at is null
    and fr.firm_id = p_firm_id
    and fr.slug = 'firm_owner'
    and (
      e.firm_role_id is null
      or e.individual_permissions is null
      or e.individual_permissions = '{}'::jsonb
      or e.role not in ('firm_manager', 'admin', 'super_admin')
    );
end;
$$;

revoke all on function private.repair_current_office_owner_access(uuid) from public;
grant execute on function private.repair_current_office_owner_access(uuid) to authenticated, service_role;

create or replace function private.can_delete_clients()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select (select private.is_office_admin())
    or coalesce((select private.has_permission('clients.delete')), false)
    or exists (
      select 1
      from public.employees e
      where e.auth_uid = (select auth.uid())
        and e.deleted_at is null
        and e.status = 'active'
        and e.role in (
          'firm_manager'::public.employee_role_enum,
          'admin'::public.employee_role_enum,
          'super_admin'::public.employee_role_enum
        )
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.deleted_at is null
        and p.role::text in ('admin', 'firm_manager', 'super_admin')
    );
$$;

create or replace function private.can_delete_execution_requests()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select (select private.can_delete_clients())
    or coalesce((select private.has_permission('cases.delete')), false);
$$;

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

  perform private.repair_current_office_owner_access(v_firm_id);

  if not (select private.is_firm_subscription_active()) then
    raise exception 'subscription_inactive';
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

  perform private.repair_current_office_owner_access(v_firm_id);

  if not (select private.is_firm_subscription_active()) then
    raise exception 'subscription_inactive';
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

revoke all on function public.delete_client(uuid) from public;
revoke all on function public.delete_execution_request(uuid) from public;
grant execute on function public.delete_client(uuid) to authenticated;
grant execute on function public.delete_execution_request(uuid) to authenticated;

-- Old bundle fallback: direct PATCH soft-delete for firm managers
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_update_staff" on public.clients;

create policy "clients_update" on public.clients
  for update
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_firm_subscription_active())
    and (
      deleted_at is null
      and (
        (select private.can_delete_clients())
        or (select private.has_permission('clients.edit'))
      )
    )
    or (
      deleted_at is not null
      and (select private.is_office_admin())
    )
  )
  with check (
    firm_id = (select private.get_current_firm_id())
  );

grant select, insert, update on public.clients to authenticated;

notify pgrst, 'reload schema';
