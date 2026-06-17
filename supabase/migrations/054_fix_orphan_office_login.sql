-- Fix orphaned office logins: stale profiles, mismatched auth_uid, missing profile rows

-- 1) Remove ghost profiles that share an email with a different auth user
update public.profiles p
set deleted_at = now(), updated_at = now()
from auth.users u
where p.deleted_at is null
  and lower(trim(p.email)) = lower(trim(u.email))
  and p.id <> u.id;

-- 2) Relink employees to the auth user that owns the same email
update public.employees e
set auth_uid = u.id,
    status = 'active',
    updated_at = now()
from auth.users u
where e.deleted_at is null
  and e.email is not null
  and lower(trim(e.email)) = lower(trim(u.email))
  and e.auth_uid is distinct from u.id;

-- 3) Promote firm-email owners still marked as lawyer
update public.employees e
set role = 'firm_manager'::public.employee_role_enum,
    status = 'active',
    updated_at = now()
from public.firms f
where e.firm_id = f.id
  and e.deleted_at is null
  and f.deleted_at is null
  and e.role::text = 'lawyer'
  and lower(trim(coalesce(e.email, ''))) = lower(trim(coalesce(f.email, '')));

-- 4) Create missing profiles for auth users already linked to employees
insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
select
  u.id,
  e.firm_id,
  e.id,
  coalesce(nullif(trim(e.full_name), ''), split_part(u.email, '@', 1)),
  lower(trim(u.email)),
  case e.role::text
    when 'lawyer' then 'lawyer'::public.profile_role_enum
    when 'assistant' then 'assistant'::public.profile_role_enum
    else 'admin'::public.profile_role_enum
  end,
  e.phone
from auth.users u
inner join public.employees e
  on e.deleted_at is null
 and e.auth_uid = u.id
where not exists (
  select 1
  from public.profiles p
  where p.id = u.id
    and p.deleted_at is null
)
on conflict (id) do update
  set firm_id = excluded.firm_id,
      employee_id = excluded.employee_id,
      full_name = excluded.full_name,
      email = excluded.email,
      role = excluded.role,
      phone = excluded.phone,
      deleted_at = null,
      updated_at = now();

-- 5) Stronger repair for login-time profile linking
create or replace function public.repair_current_user_profile()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, private
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_employee public.employees%rowtype;
  v_firm_id uuid;
  v_meta jsonb;
  v_profile_role public.profile_role_enum;
  v_conflict uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    return jsonb_build_object('ok', true, 'action', 'profile_exists');
  end if;

  update public.profiles
  set deleted_at = null, updated_at = now()
  where id = v_uid and deleted_at is not null;

  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    return jsonb_build_object('ok', true, 'action', 'profile_restored');
  end if;

  select lower(trim(email)), coalesce(raw_user_meta_data, '{}'::jsonb)
  into v_email, v_meta
  from auth.users
  where id = v_uid;

  if v_email is null then
    raise exception 'auth_user_not_found';
  end if;

  v_full_name := coalesce(
    nullif(trim(v_meta->>'full_name'), ''),
    nullif(trim(v_meta->>'owner_full_name'), ''),
    split_part(v_email, '@', 1)
  );

  -- Drop stale profiles that block linking for the verified email owner
  update public.profiles p
  set deleted_at = now(), updated_at = now()
  where p.deleted_at is null
    and lower(trim(p.email)) = v_email
    and p.id <> v_uid;

  select p.id into v_conflict
  from public.profiles p
  where lower(trim(p.email)) = v_email
    and p.id <> v_uid
    and p.deleted_at is null
  limit 1;

  if v_conflict is not null then
    raise exception 'email_linked_to_another_account';
  end if;

  -- Employee already linked to this auth user
  select e.* into v_employee
  from public.employees e
  where e.deleted_at is null and e.auth_uid = v_uid
  order by e.created_at desc
  limit 1;

  -- Employee with same email (relink orphaned / stale auth_uid)
  if not found then
    select e.* into v_employee
    from public.employees e
    where e.deleted_at is null
      and e.email is not null
      and lower(trim(e.email)) = v_email
      and (
        e.auth_uid is null
        or e.auth_uid = v_uid
        or not exists (select 1 from auth.users u where u.id = e.auth_uid)
        or not exists (
          select 1
          from public.profiles p
          where p.id = e.auth_uid
            and p.deleted_at is null
        )
      )
    order by
      case e.role::text
        when 'super_admin' then 0
        when 'firm_manager' then 1
        when 'admin' then 2
        else 3
      end,
      e.created_at desc
    limit 1;

    if found and v_employee.auth_uid is distinct from v_uid then
      update public.employees
      set auth_uid = v_uid, status = 'active', updated_at = now()
      where id = v_employee.id;
      select * into v_employee from public.employees where id = v_employee.id;
    end if;
  end if;

  -- Last-chance: email owns this employee row (password login verified)
  if not found then
    select e.* into v_employee
    from public.employees e
    where e.deleted_at is null
      and lower(trim(coalesce(e.email, ''))) = v_email
    order by
      case e.role::text
        when 'super_admin' then 0
        when 'firm_manager' then 1
        when 'admin' then 2
        else 3
      end,
      e.created_at desc
    limit 1;

    if found then
      update public.employees
      set auth_uid = v_uid, status = 'active', updated_at = now()
      where id = v_employee.id;
      select * into v_employee from public.employees where id = v_employee.id;
    end if;
  end if;

  if found then
    v_profile_role := case v_employee.role::text
      when 'lawyer' then 'lawyer'::public.profile_role_enum
      when 'assistant' then 'assistant'::public.profile_role_enum
      else 'admin'::public.profile_role_enum
    end;

    insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
    values (
      v_uid,
      v_employee.firm_id,
      v_employee.id,
      coalesce(nullif(trim(v_employee.full_name), ''), v_full_name),
      coalesce(nullif(trim(v_employee.email), ''), v_email),
      v_profile_role,
      v_employee.phone
    )
    on conflict (id) do update
      set firm_id = excluded.firm_id,
          employee_id = excluded.employee_id,
          full_name = excluded.full_name,
          email = excluded.email,
          role = excluded.role,
          phone = excluded.phone,
          deleted_at = null,
          updated_at = now();

    return jsonb_build_object('ok', true, 'action', 'linked_employee', 'employee_id', v_employee.id);
  end if;

  -- Firm matched by email (create owner employee)
  select f.id into v_firm_id
  from public.firms f
  where f.deleted_at is null
    and lower(trim(coalesce(f.email, ''))) = v_email
  order by f.created_at desc
  limit 1;

  if v_firm_id is null then
    select f.id into v_firm_id
    from public.firms f
    inner join public.employees e on e.firm_id = f.id and e.deleted_at is null
    where f.deleted_at is null
      and lower(trim(coalesce(e.email, ''))) = v_email
    order by f.created_at desc
    limit 1;
  end if;

  if v_firm_id is not null then
    insert into public.employees (auth_uid, firm_id, full_name, email, role, status)
    values (
      v_uid,
      v_firm_id,
      coalesce(
        (select nullif(trim(f.owner_full_name), '') from public.firms f where f.id = v_firm_id),
        v_full_name
      ),
      v_email,
      coalesce(
        (
          select e.role
          from public.employees e
          where e.firm_id = v_firm_id
            and e.deleted_at is null
            and lower(trim(coalesce(e.email, ''))) = v_email
          order by e.created_at
          limit 1
        ),
        'firm_manager'::public.employee_role_enum
      ),
      'active'
    )
    returning * into v_employee;

    insert into public.profiles (id, firm_id, employee_id, full_name, email, role)
    values (v_uid, v_firm_id, v_employee.id, v_employee.full_name, v_email, 'admin'::public.profile_role_enum)
    on conflict (id) do update
      set firm_id = excluded.firm_id,
          employee_id = excluded.employee_id,
          deleted_at = null,
          updated_at = now();

    return jsonb_build_object('ok', true, 'action', 'created_from_firm_email', 'firm_id', v_firm_id);
  end if;

  if lower(coalesce(v_meta->>'registration_flow', '')) = 'office'
     or nullif(trim(coalesce(v_meta->>'office_name', v_meta->>'company', '')), '') is not null then
    perform public.create_office_admin_profile(
      v_uid,
      coalesce(nullif(trim(v_meta->>'office_name'), ''), nullif(trim(v_meta->>'company'), ''), 'مكتب محاماة'),
      v_full_name,
      v_email,
      nullif(trim(coalesce(v_meta->>'phone', '')), '')
    );
    return jsonb_build_object('ok', true, 'action', 'created_office_profile');
  end if;

  if exists (select 1 from private.platform_operators po where po.auth_uid = v_uid) then
    perform public.create_office_admin_profile(v_uid, 'LegalMind Platform', v_full_name, v_email, null);
    update public.employees set role = 'super_admin' where auth_uid = v_uid and deleted_at is null;
    insert into private.platform_operators (auth_uid) values (v_uid) on conflict (auth_uid) do nothing;
    return jsonb_build_object('ok', true, 'action', 'created_platform_admin');
  end if;

  if not exists (
    select 1 from public.firms f
    where f.deleted_at is null and lower(trim(coalesce(f.email, ''))) = v_email
  ) and not exists (
    select 1 from public.employees e
    where e.deleted_at is null and lower(trim(coalesce(e.email, ''))) = v_email
  ) then
    perform public.create_office_admin_profile(
      v_uid,
      coalesce(nullif(trim(v_meta->>'office_name'), ''), nullif(trim(v_meta->>'company'), ''), 'مكتب محاماة'),
      v_full_name,
      v_email,
      nullif(trim(coalesce(v_meta->>'phone', '')), '')
    );
    return jsonb_build_object('ok', true, 'action', 'provisioned_new_office');
  end if;

  raise exception 'profile_repair_failed';
end;
$$;

revoke all on function public.repair_current_user_profile() from public;
grant execute on function public.repair_current_user_profile() to authenticated;
