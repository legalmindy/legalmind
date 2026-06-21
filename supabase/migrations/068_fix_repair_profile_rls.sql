-- Harden repair_current_user_profile: bypass RLS + preserve pending member status

create or replace function private.upsert_profile_for_employee(
  p_uid uuid,
  p_employee public.employees,
  p_email text,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role_text text := public.profile_role_from_employee_role(p_employee.role::text);
  v_col_type text := private.profiles_role_column_type();
begin
  perform set_config('row_security', 'off', true);

  if v_col_type = 'profile_role_enum' then
    insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
    values (
      p_uid,
      p_employee.firm_id,
      p_employee.id,
      coalesce(nullif(trim(p_employee.full_name), ''), p_full_name),
      coalesce(nullif(trim(p_employee.email), ''), p_email),
      v_role_text::public.profile_role_enum,
      p_employee.phone
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
  else
    insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
    values (
      p_uid,
      p_employee.firm_id,
      p_employee.id,
      coalesce(nullif(trim(p_employee.full_name), ''), p_full_name),
      coalesce(nullif(trim(p_employee.email), ''), p_email),
      v_role_text::public.employee_role_enum,
      p_employee.phone
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
  end if;
end;
$$;

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
  v_conflict uuid;
begin
  perform set_config('row_security', 'off', true);

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

  select e.* into v_employee
  from public.employees e
  where e.deleted_at is null
    and (
      e.auth_uid = v_uid
      or lower(trim(coalesce(e.email, ''))) = v_email
    )
  order by
    case when e.auth_uid = v_uid then 0 else 1 end,
    case e.role::text
      when 'super_admin' then 0
      when 'firm_manager' then 1
      when 'admin' then 2
      else 3
    end,
    e.created_at desc
  limit 1;

  if found then
    if v_employee.auth_uid is distinct from v_uid then
      update public.employees
      set auth_uid = v_uid, updated_at = now()
      where id = v_employee.id;
      select * into v_employee from public.employees where id = v_employee.id;
    end if;

    perform private.upsert_profile_for_employee(v_uid, v_employee, v_email, v_full_name);

    if v_employee.role::text = 'super_admin' then
      insert into private.platform_operators (auth_uid)
      values (v_uid)
      on conflict (auth_uid) do nothing;
    end if;

    return jsonb_build_object('ok', true, 'action', 'linked_employee', 'employee_id', v_employee.id);
  end if;

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
      'firm_manager'::public.employee_role_enum,
      'active'
    )
    returning * into v_employee;

    perform private.upsert_profile_for_employee(v_uid, v_employee, v_email, v_full_name);
    return jsonb_build_object('ok', true, 'action', 'created_from_firm_email', 'firm_id', v_firm_id);
  end if;

  if lower(coalesce(v_meta->>'registration_flow', '')) in ('office_member', 'lawyer') then
    raise exception 'profile_repair_failed';
  end if;

  if not exists (
    select 1 from public.firms f
    where f.deleted_at is null and lower(trim(coalesce(f.email, ''))) = v_email
  ) and not exists (
    select 1 from public.employees e
    where e.deleted_at is null and lower(trim(coalesce(e.email, ''))) = v_email
  ) then
    if lower(coalesce(v_meta->>'registration_flow', '')) = 'office'
       or nullif(trim(coalesce(v_meta->>'office_name', v_meta->>'company', '')), '') is not null
       or exists (select 1 from private.platform_operators po where po.auth_uid = v_uid) then
      perform public.create_office_admin_profile(
        v_uid,
        coalesce(nullif(trim(v_meta->>'office_name'), ''), nullif(trim(v_meta->>'company'), ''), 'LegalMind Platform'),
        v_full_name,
        v_email,
        nullif(trim(coalesce(v_meta->>'phone', '')), '')
      );

      update public.employees
      set role = 'super_admin', status = 'active'
      where auth_uid = v_uid
        and deleted_at is null
        and exists (select 1 from private.platform_operators po where po.auth_uid = v_uid);

      insert into private.platform_operators (auth_uid)
      values (v_uid)
      on conflict (auth_uid) do nothing;

      return jsonb_build_object('ok', true, 'action', 'created_office_profile');
    end if;

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
