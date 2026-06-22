-- Fix invite signup when profiles.role uses employee_role_enum (not profile_role_enum),
-- and relink soft-deleted / orphaned employee rows instead of failing on unique email.

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
  new_employee    public.employees%rowtype;
  final_name      text;
  final_phone     text;
  v_role_slug     text;
  v_role_permissions jsonb;
  v_existing_id   uuid;
  v_existing_firm uuid;
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

  select e.id, e.firm_id
  into v_existing_id, v_existing_firm
  from public.employees e
  where lower(e.email) = lower(inv.email)
  order by e.deleted_at nulls first, e.created_at desc
  limit 1;

  if v_existing_id is not null
     and v_existing_firm is distinct from inv.firm_id then
    raise exception 'Email already registered as an employee'
      using errcode = 'unique_violation';
  end if;

  if v_existing_id is not null
     and exists (
       select 1
       from public.employees e
       where e.id = v_existing_id
         and e.deleted_at is null
         and e.auth_uid is not null
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

  if v_existing_id is not null then
    update public.employees e
    set auth_uid = auth_user_id,
        firm_id = inv.firm_id,
        full_name = final_name,
        email = inv.email,
        phone = coalesce(final_phone, e.phone),
        role = inv.role,
        status = 'active',
        firm_role_id = coalesce(inv.firm_role_id, e.firm_role_id),
        individual_permissions = coalesce(v_role_permissions, e.individual_permissions, '{}'::jsonb),
        deleted_at = null,
        updated_at = now()
    where e.id = v_existing_id
    returning * into new_employee;
  else
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
    returning * into new_employee;
  end if;

  perform private.upsert_profile_for_employee(
    auth_user_id,
    new_employee,
    inv.email,
    final_name
  );

  if inv.role = 'lawyer'
     or coalesce(v_role_slug, '') in ('lawyer', 'managing_lawyer') then
    insert into public.lawyers(employee_id)
    values (new_employee.id)
    on conflict (employee_id) do nothing;
  end if;

  update public.invitations
  set status = 'accepted',
      accepted_at = now(),
      employee_id = new_employee.id
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
  target_employee public.employees%rowtype;
  auth_email text;
  v_role_permissions jsonb;
  v_phone text;
  v_existing_id uuid;
  v_existing_firm uuid;
  v_target_employee_id uuid;
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

  select e.id, e.firm_id
  into v_existing_id, v_existing_firm
  from public.employees e
  where lower(e.email) = lower(inv.email)
  order by e.deleted_at nulls first, e.created_at desc
  limit 1;

  if v_existing_id is not null
     and v_existing_firm is distinct from inv.firm_id then
    raise exception 'Email already registered as an employee';
  end if;

  select e.id
  into v_target_employee_id
  from public.employees e
  where lower(e.email) = lower(inv.email)
    and e.firm_id = inv.firm_id
    and e.deleted_at is null
  limit 1;

  if v_target_employee_id is null and v_existing_id is not null then
    v_target_employee_id := v_existing_id;
  end if;

  if v_target_employee_id is null then
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
    returning * into target_employee;
  else
    update public.employees e
    set auth_uid = auth.uid(),
        full_name = coalesce(inv.full_name, e.full_name),
        phone = coalesce(v_phone, e.phone),
        role = inv.role,
        status = 'active',
        firm_role_id = coalesce(inv.firm_role_id, e.firm_role_id),
        individual_permissions = coalesce(v_role_permissions, e.individual_permissions, '{}'::jsonb),
        deleted_at = null,
        updated_at = now()
    where e.id = v_target_employee_id
    returning * into target_employee;
  end if;

  if inv.role = 'lawyer'
     or exists (
       select 1 from public.firm_roles fr
       where fr.id = inv.firm_role_id
         and fr.slug in ('lawyer', 'managing_lawyer')
     ) then
    insert into public.lawyers(employee_id)
    values (target_employee.id)
    on conflict (employee_id) do nothing;
  end if;

  perform private.upsert_profile_for_employee(
    auth.uid(),
    target_employee,
    inv.email,
    coalesce(inv.full_name, split_part(inv.email, '@', 1))
  );

  update public.invitations
  set status = 'accepted',
      accepted_at = now(),
      employee_id = target_employee.id
  where id = inv.id;

  return inv.firm_id;
end;
$$;

revoke all on function public.create_invited_profile(uuid, text, text, text) from public;
grant execute on function public.create_invited_profile(uuid, text, text, text) to authenticated, service_role;

revoke all on function public.accept_invitation_for_auth_user(text) from public;
grant execute on function public.accept_invitation_for_auth_user(text) to authenticated;
