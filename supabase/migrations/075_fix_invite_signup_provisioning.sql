-- Fix invite signup failing when invitation phone is empty or formatted invalidly.
-- Also harden provisioning with row_security off and normalized phone storage.

create or replace function public.sanitize_employee_phone(raw_phone text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text;
begin
  normalized := public.normalize_yemeni_phone_for_storage(raw_phone);
  if normalized is null then
    return null;
  end if;
  if normalized !~ '^(77|73|71|70)[0-9]{7}$' then
    return null;
  end if;
  return normalized;
end;
$$;

revoke all on function public.sanitize_employee_phone(text) from public;
grant execute on function public.sanitize_employee_phone(text) to service_role;

create or replace function public.create_invited_profile(
  auth_user_id uuid,
  raw_token     text,
  invited_name  text,
  invited_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inv             public.invitations%rowtype;
  target_firm     public.firms%rowtype;
  new_employee_id uuid;
  final_name      text;
  final_phone     text;
  v_role_slug     text;
  v_role_permissions jsonb;
begin
  perform set_config('row_security', 'off', true);
  perform public.expire_old_invitations();

  select * into inv
  from public.invitations
  where token_hash = public.invitation_hash(raw_token)
  for update;

  if not found or inv.status <> 'pending' or inv.expires_at <= now() then
    raise exception 'Invitation is invalid or expired'
      using errcode = 'invalid_parameter_value';
  end if;

  if lower(inv.email) <> lower(invited_email) then
    raise exception 'Invitation email does not match'
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (
    select 1
    from public.employees e
    where lower(e.email) = lower(inv.email)
      and e.deleted_at is null
      and e.auth_uid is distinct from auth_user_id
  ) then
    raise exception 'Email already registered as an employee'
      using errcode = 'unique_violation';
  end if;

  select * into target_firm
  from public.firms
  where id = inv.firm_id
    and deleted_at is null;

  if not found then
    raise exception 'Firm not found'
      using errcode = 'invalid_parameter_value';
  end if;

  if inv.firm_role_id is not null then
    select fr.slug, fr.permissions
    into v_role_slug, v_role_permissions
    from public.firm_roles fr
    where fr.id = inv.firm_role_id;
  end if;

  final_name := coalesce(
    nullif(trim(invited_name), ''),
    nullif(trim(inv.full_name), ''),
    split_part(inv.email, '@', 1)
  );
  final_phone := public.sanitize_employee_phone(inv.phone);

  insert into public.employees(
    auth_uid, firm_id, full_name, email, phone, role, status, firm_role_id, individual_permissions
  )
  values (
    auth_user_id,
    target_firm.id,
    final_name,
    inv.email,
    final_phone,
    inv.role,
    'active',
    inv.firm_role_id,
    coalesce(v_role_permissions, '{}'::jsonb)
  )
  returning id into new_employee_id;

  insert into public.profiles(id, firm_id, employee_id, full_name, email, phone, role)
  values (
    auth_user_id,
    inv.firm_id,
    new_employee_id,
    final_name,
    inv.email,
    final_phone,
    case inv.role::text
      when 'admin' then 'admin'::public.profile_role_enum
      when 'lawyer' then 'lawyer'::public.profile_role_enum
      when 'firm_manager' then 'admin'::public.profile_role_enum
      else 'assistant'::public.profile_role_enum
    end
  )
  on conflict (id) do update
    set firm_id = excluded.firm_id,
        employee_id = excluded.employee_id,
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        role = excluded.role,
        deleted_at = null;

  if inv.role = 'lawyer'
     or coalesce(v_role_slug, '') in ('lawyer', 'managing_lawyer') then
    insert into public.lawyers(employee_id)
    values (new_employee_id)
    on conflict (employee_id) do nothing;
  end if;

  update public.invitations
  set status = 'accepted',
      accepted_at = now(),
      employee_id = new_employee_id
  where id = inv.id;

  return inv.firm_id;
end;
$$;

create or replace function public.accept_invitation_for_auth_user(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inv public.invitations%rowtype;
  target_employee_id uuid;
  auth_email text;
  profile_role public.profile_role_enum;
  v_role_permissions jsonb;
  v_phone text;
begin
  perform set_config('row_security', 'off', true);

  auth_email := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
  if auth_email = '' then
    raise exception 'Authenticated user is required';
  end if;

  select * into inv
  from public.invitations
  where token_hash = public.invitation_hash(raw_token)
  for update;

  if not found or inv.status <> 'pending' or inv.expires_at <= now() then
    raise exception 'Invitation is invalid or expired';
  end if;

  if lower(inv.email) <> auth_email then
    raise exception 'Invitation email does not match current user';
  end if;

  if inv.firm_role_id is not null then
    select fr.permissions into v_role_permissions
    from public.firm_roles fr
    where fr.id = inv.firm_role_id;
  end if;

  v_phone := public.sanitize_employee_phone(inv.phone);

  select id into target_employee_id
  from public.employees
  where lower(email) = lower(inv.email)
    and firm_id = inv.firm_id
    and deleted_at is null
  limit 1;

  if target_employee_id is null then
    insert into public.employees (
      auth_uid, firm_id, full_name, email, phone, role, status, firm_role_id, individual_permissions
    )
    values (
      auth.uid(),
      inv.firm_id,
      coalesce(inv.full_name, split_part(inv.email, '@', 1)),
      inv.email,
      v_phone,
      inv.role,
      'active',
      inv.firm_role_id,
      coalesce(v_role_permissions, '{}'::jsonb)
    )
    returning id into target_employee_id;
  else
    update public.employees
    set auth_uid = auth.uid(),
        full_name = coalesce(inv.full_name, full_name),
        phone = coalesce(v_phone, phone),
        role = inv.role,
        status = 'active',
        firm_role_id = coalesce(inv.firm_role_id, firm_role_id),
        individual_permissions = coalesce(v_role_permissions, individual_permissions, '{}'::jsonb),
        deleted_at = null
    where id = target_employee_id;
  end if;

  if inv.role = 'lawyer'
     or exists (
       select 1 from public.firm_roles fr
       where fr.id = inv.firm_role_id
         and fr.slug in ('lawyer', 'managing_lawyer')
     ) then
    insert into public.lawyers(employee_id)
    values (target_employee_id)
    on conflict (employee_id) do nothing;
  end if;

  profile_role := case inv.role::text
    when 'admin' then 'admin'::public.profile_role_enum
    when 'lawyer' then 'lawyer'::public.profile_role_enum
    when 'firm_manager' then 'admin'::public.profile_role_enum
    when 'super_admin' then 'admin'::public.profile_role_enum
    else 'assistant'::public.profile_role_enum
  end;

  insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
  values (
    auth.uid(),
    inv.firm_id,
    target_employee_id,
    coalesce(inv.full_name, split_part(inv.email, '@', 1)),
    inv.email,
    profile_role,
    v_phone
  )
  on conflict (id) do update
    set firm_id = excluded.firm_id,
        employee_id = excluded.employee_id,
        full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        phone = coalesce(excluded.phone, profiles.phone),
        deleted_at = null;

  update public.invitations
  set status = 'accepted',
      accepted_at = now(),
      employee_id = target_employee_id
  where id = inv.id;

  return inv.firm_id;
end;
$$;

revoke all on function public.create_invited_profile(uuid, text, text, text) from public;
grant execute on function public.create_invited_profile(uuid, text, text, text) to authenticated, service_role;

revoke all on function public.accept_invitation_for_auth_user(text) from public;
grant execute on function public.accept_invitation_for_auth_user(text) to authenticated;
