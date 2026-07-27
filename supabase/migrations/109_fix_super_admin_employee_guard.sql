-- Fix: guard_employee_privilege_columns blocked super-admin promotion
-- SQL Editor has no auth.uid(); claim_billing_admin_setup updates employees.role → not_authorized

create or replace function private.guard_employee_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  -- Migrations / SQL Editor / DB roles without an end-user JWT
  if auth.uid() is null then
    return new;
  end if;

  -- Explicit bypass flags used by SECURITY DEFINER RPCs / provisioning
  if coalesce(current_setting('app.office_provisioning', true), '') = 'on'
     or coalesce(current_setting('app.subscription_bypass', true), '') = 'on'
     or coalesce(current_setting('app.employee_privilege_bypass', true), '') = 'on' then
    return new;
  end if;

  if private.is_office_admin()
     or private.is_platform_operator()
     or private.is_subscription_super_admin()
     or private.is_billing_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.firm_role_id is distinct from old.firm_role_id
     or new.status is distinct from old.status
     or new.firm_id is distinct from old.firm_id
     or new.auth_uid is distinct from old.auth_uid
     or new.email is distinct from old.email
     or new.individual_permissions is distinct from old.individual_permissions
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'not_authorized'
      using hint = 'Only office admins or platform super-admins can change employee privileges.';
  end if;

  return new;
end;
$$;

-- Keep 094 claim rules; add privilege-bypass around the employees UPDATE
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
  v_profiles_role_type text := private.profiles_role_column_type();
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

  perform set_config('app.employee_privilege_bypass', 'on', true);

  update public.employees
  set role = 'super_admin',
      status = 'active',
      updated_at = now()
  where id = v_employee_id;

  -- profile_role_enum may not include super_admin; use admin as UI-compatible fallback
  if v_profiles_role_type = 'profile_role_enum' then
    update public.profiles
    set role = 'admin',
        updated_at = now()
    where id = v_uid;
  else
    update public.profiles
    set role = 'super_admin',
        updated_at = now()
    where id = v_uid;
  end if;

  insert into private.platform_operators (auth_uid)
  values (v_uid)
  on conflict (auth_uid) do nothing;

  perform set_config('app.employee_privilege_bypass', 'off', true);

  return jsonb_build_object('ok', true, 'claimed', true);
end;
$$;

revoke all on function public.claim_billing_admin_setup() from public;
grant execute on function public.claim_billing_admin_setup() to authenticated;
