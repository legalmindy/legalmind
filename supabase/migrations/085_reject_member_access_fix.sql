-- LegalMind Yemen — Fix rejected office members retaining dashboard access
-- Root cause: reject_member_registration soft-deleted employees but left profiles
-- linked to the firm, so login succeeded while the member list hid them.

-- ─── one-time repair: orphan profiles for rejected employees ────────────────
-- Note: firm_id is immutable (migration 038); soft-delete profile only.
update public.profiles p
set
  deleted_at = coalesce(p.deleted_at, now()),
  employee_id = null,
  updated_at = now()
from public.employees e
where p.deleted_at is null
  and (
    (p.employee_id is not null and p.employee_id = e.id)
    or (p.id = e.auth_uid)
  )
  and e.deleted_at is not null
  and e.status = 'disabled';

-- ─── reject pending member (also detach profile) ────────────────────────────
create or replace function public.reject_member_registration(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
  v_auth_uid uuid;
begin
  if not private.is_office_admin() then
    raise exception 'not_authorized';
  end if;

  v_firm_id := private.get_current_firm_id();

  update public.employees
  set status = 'disabled', deleted_at = now(), updated_at = now()
  where id = p_employee_id
    and firm_id = v_firm_id
    and deleted_at is null
    and status = 'pending_approval'
  returning auth_uid into v_auth_uid;

  if not found then
    raise exception 'member_not_pending';
  end if;

  update public.profiles
  set
    deleted_at = now(),
    employee_id = null,
    updated_at = now()
  where deleted_at is null
    and (
      employee_id = p_employee_id
      or (v_auth_uid is not null and id = v_auth_uid)
    );
end;
$$;

-- ─── profile context: only active memberships ───────────────────────────────
create or replace function public.get_current_profile_context()
returns table (
  profile_id uuid,
  firm_id uuid,
  employee_id uuid,
  full_name text,
  email text,
  role text,
  firm_name text,
  firm_code text
)
language plpgsql
stable
security invoker
set search_path = public, private
as $$
begin
  return query
  select
    p.id,
    p.firm_id,
    p.employee_id,
    p.full_name,
    p.email,
    coalesce(e.role::text, p.role::text) as role,
    f.name,
    f.firm_code::text
  from public.profiles p
  inner join public.employees e
    on e.id = p.employee_id
   and e.deleted_at is null
   and e.status in ('active', 'pending_approval', 'suspended')
  left join public.firms f on f.id = p.firm_id
  where p.id = (select auth.uid())
    and p.deleted_at is null;
end;
$$;

-- ─── repair: never restore profiles for rejected memberships ────────────────
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

  if exists (
    select 1
    from public.employees e
    where e.auth_uid = v_uid
      and e.deleted_at is not null
      and e.status = 'disabled'
  ) then
    return jsonb_build_object('ok', false, 'action', 'membership_rejected');
  end if;

  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    return jsonb_build_object('ok', true, 'action', 'profile_exists');
  end if;

  update public.profiles p
  set deleted_at = null, updated_at = now()
  where p.id = v_uid
    and p.deleted_at is not null
    and exists (
      select 1
      from public.employees e
      where e.id = p.employee_id
        and e.deleted_at is null
        and e.status in ('active', 'pending_approval', 'suspended')
    );

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

-- ─── block re-registration after rejection for same office ──────────────────
create or replace function public.create_office_member_profile(
  auth_user_id uuid,
  office_code_input text,
  member_name text,
  member_email text,
  firm_role_slug_input text default 'lawyer'
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_firm_id uuid;
  new_employee_id uuid;
  v_firm_role_id uuid;
  v_role_slug text := lower(trim(coalesce(firm_role_slug_input, 'lawyer')));
  v_legacy_role public.employee_role_enum;
  v_role_permissions jsonb;
  normalized_code text := upper(trim(office_code_input));
  normalized_email text := lower(trim(member_email));
  normalized_name text := trim(member_name);
begin
  perform set_config('row_security', 'off', true);

  if char_length(normalized_name) < 2 then
    raise exception 'Member name must be at least 2 characters' using errcode = 'check_violation';
  end if;

  if normalized_code = '' or not is_valid_firm_code_format(normalized_code) then
    raise exception 'Invalid firm code format' using errcode = 'check_violation';
  end if;

  if v_role_slug = '' or v_role_slug = 'firm_owner' then
    raise exception 'Invalid role selection' using errcode = 'check_violation';
  end if;

  select g.id into target_firm_id
  from get_office_by_firm_code(normalized_code) g
  limit 1;

  if target_firm_id is null then
    raise exception 'Firm code does not exist: %', normalized_code using errcode = 'no_data_found';
  end if;

  select fr.id, fr.permissions into v_firm_role_id, v_role_permissions
  from public.firm_roles fr
  where fr.firm_id = target_firm_id
    and fr.slug = v_role_slug
    and fr.slug <> 'firm_owner'
  limit 1;

  if v_firm_role_id is null then
    raise exception 'Role not found for this office: %', v_role_slug using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from employees e
    where lower(e.email) = normalized_email and e.deleted_at is null
  ) then
    raise exception 'Email already registered as an employee' using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from employees e
    where lower(e.email) = normalized_email
      and e.firm_id = target_firm_id
      and e.deleted_at is not null
      and e.status = 'disabled'
  ) then
    raise exception 'Previous membership request was rejected for this office' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from profiles p
    where lower(p.email) = normalized_email and p.deleted_at is null
  ) then
    raise exception 'Email already registered' using errcode = 'unique_violation';
  end if;

  v_legacy_role := case
    when v_role_slug in ('lawyer', 'managing_lawyer') then 'lawyer'::public.employee_role_enum
    else 'assistant'::public.employee_role_enum
  end;

  insert into employees(auth_uid, firm_id, full_name, email, role, status, firm_role_id, individual_permissions)
  values (
    auth_user_id, target_firm_id, normalized_name, normalized_email, v_legacy_role,
    'pending_approval', v_firm_role_id, coalesce(v_role_permissions, '{}'::jsonb)
  )
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role)
  values (auth_user_id, target_firm_id, new_employee_id, normalized_name, normalized_email, v_legacy_role);

  return target_firm_id;
end;
$$;

revoke all on function public.reject_member_registration(uuid) from public, anon;
grant execute on function public.reject_member_registration(uuid) to authenticated;

revoke all on function public.get_current_profile_context() from public;
grant execute on function public.get_current_profile_context() to authenticated;

revoke all on function public.repair_current_user_profile() from public;
grant execute on function public.repair_current_user_profile() to authenticated;
