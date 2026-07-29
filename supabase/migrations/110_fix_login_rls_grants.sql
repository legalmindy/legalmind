-- Fix login 401/403: security sweeps revoked EXECUTE on public wrappers used by RLS.
-- Policies like employees_select_firm call public.get_current_firm_id() without
-- EXECUTE for authenticated → every employees SELECT fails → login blocked.

-- ─── 1) Restore EXECUTE on public auth/RLS helpers ───────────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_current_firm_id',
        'get_current_role',
        'get_current_employee_id',
        'get_current_lawyer_id',
        'is_firm_manager',
        'is_office_admin',
        'can_access_case',
        'is_firm_subscription_active',
        'get_my_permissions',
        'log_security_event',
        'is_billing_admin',
        'is_subscription_super_admin',
        'is_platform_operator',
        'can_access_super_admin_billing',
        'repair_current_user_profile',
        'ensure_platform_billing_access',
        'claim_billing_admin_setup'
      )
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- Keep private helpers executable too (policies / DEFINER bodies)
grant execute on function private.get_current_firm_id() to authenticated, service_role;
grant execute on function private.get_current_role() to authenticated, service_role;
grant execute on function private.is_office_admin() to authenticated, service_role;
grant execute on function private.is_firm_manager() to authenticated, service_role;

-- ─── 2) Dedicated login status RPC (SECURITY DEFINER — no RLS chicken/egg) ───
create or replace function public.get_my_employee_access_status()
returns text
language plpgsql
stable
security definer
set search_path = public, private, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_deleted timestamptz;
begin
  if v_uid is null then
    return null;
  end if;

  select e.status::text, e.deleted_at
  into v_status, v_deleted
  from public.employees e
  where e.auth_uid = v_uid
  order by e.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  if v_deleted is not null then
    return 'disabled';
  end if;

  return v_status;
end;
$$;

revoke all on function public.get_my_employee_access_status() from public;
grant execute on function public.get_my_employee_access_status() to authenticated;

-- ─── 3) Ensure own-row select policy exists (login before firm context) ──────
drop policy if exists "employees_select_own_auth" on public.employees;
create policy "employees_select_own_auth" on public.employees
  for select
  to authenticated
  using (
    auth_uid = (select auth.uid())
    and deleted_at is null
  );

-- Fix legacy policy that calls unqualified public.get_current_firm_id()
drop policy if exists "employees_select_firm" on public.employees;
create policy "employees_select_firm" on public.employees
  for select
  to authenticated
  using (
    deleted_at is null
    and firm_id = (select private.get_current_firm_id())
  );
