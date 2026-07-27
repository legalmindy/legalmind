-- Fix remaining login 403: public.get_current_firm_id lacked EXECUTE for authenticated.
-- Legacy policies (profiles_select_firm, etc.) call unqualified get_current_firm_id()
-- which resolves to public.* and raises: permission denied for function get_current_firm_id

-- ─── 1) Grant EXECUTE on every public helper overload ────────────────────────
do $$
declare
  r record;
begin
  for r in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig
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
        'is_office_profile_admin',
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
        'claim_billing_admin_setup',
        'get_my_employee_access_status',
        'get_current_profile_context'
      )
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;

-- Public wrappers must be callable from RLS expressions (search_path = public)
grant execute on function public.get_current_firm_id() to authenticated, service_role;
grant execute on function public.get_current_role() to authenticated, service_role;

-- ─── 2) Rewrite legacy policies that used unqualified public wrappers ────────
drop policy if exists "profiles_select_firm" on public.profiles;
create policy "profiles_select_firm" on public.profiles
  for select
  to authenticated
  using (
    deleted_at is null
    and firm_id = (select private.get_current_firm_id())
  );

drop policy if exists "profiles_update_admin_firm" on public.profiles;
create policy "profiles_update_admin_firm" on public.profiles
  for update
  to authenticated
  using (
    deleted_at is null
    and firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  )
  with check (
    deleted_at is null
    and firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  );

drop policy if exists "employees_select_firm" on public.employees;
create policy "employees_select_firm" on public.employees
  for select
  to authenticated
  using (
    deleted_at is null
    and firm_id = (select private.get_current_firm_id())
  );

drop policy if exists "employees_update_admin" on public.employees;
create policy "employees_update_admin" on public.employees
  for update
  to authenticated
  using (
    deleted_at is null
    and firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  )
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  );

drop policy if exists "employees_delete_admin" on public.employees;
create policy "employees_delete_admin" on public.employees
  for delete
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  );

-- Own-row profile select (login path)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    and deleted_at is null
  );
