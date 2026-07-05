-- Restrict subscription billing admin to platform super_admin only.
-- Reverts migration 089 which incorrectly granted billing access to firm_manager/admin profiles.

create or replace function private.is_billing_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select coalesce(
    (select private.get_current_role()) = 'super_admin'::public.employee_role_enum,
    false
  )
  or exists (
    select 1
    from private.platform_operators po
    where po.auth_uid = (select auth.uid())
  );
$$;

create or replace function private.is_subscription_super_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_billing_admin();
$$;

create or replace function public.is_billing_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_billing_admin();
$$;

create or replace function public.is_subscription_super_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_billing_admin();
$$;

revoke all on function public.is_billing_admin() from public;
revoke all on function public.is_subscription_super_admin() from public;
grant execute on function public.is_billing_admin() to authenticated, service_role;
grant execute on function public.is_subscription_super_admin() to authenticated, service_role;

-- Only existing platform operators (or first-time setup when none exist) may claim super_admin.
create or replace function public.claim_billing_admin_setup()
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_employee_id uuid;
  v_has_operator boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if (select private.is_billing_admin()) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select exists (select 1 from private.platform_operators) into v_has_operator;
  if v_has_operator then
    raise exception 'not_authorized';
  end if;

  select e.id into v_employee_id
  from public.employees e
  where e.auth_uid = v_uid
    and e.deleted_at is null
  order by e.created_at desc
  limit 1;

  if v_employee_id is null then
    raise exception 'employee_not_found';
  end if;

  update public.employees
  set role = 'super_admin',
      status = 'active',
      updated_at = now()
  where id = v_employee_id;

  update public.profiles
  set role = 'super_admin',
      updated_at = now()
  where id = v_uid;

  insert into private.platform_operators (auth_uid)
  values (v_uid)
  on conflict (auth_uid) do nothing;

  return jsonb_build_object('ok', true, 'claimed', true);
end;
$$;

revoke all on function public.claim_billing_admin_setup() from public;
grant execute on function public.claim_billing_admin_setup() to authenticated;

-- Remove auto-promotion path that granted billing to any firm_manager profile.
create or replace function public.ensure_platform_billing_access()
returns boolean
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  return (select private.is_billing_admin());
end;
$$;

revoke all on function public.ensure_platform_billing_access() from public;
grant execute on function public.ensure_platform_billing_access() to authenticated;
