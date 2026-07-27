-- Fix office-member signup: profiles.role is profile_role_enum on production,
-- but create_office_member_profile inserted employee_role_enum →
-- auth/v1/signup 500 "Database error saving new user"
-- (column "role" is of type profile_role_enum but expression is of type employee_role_enum)

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
  v_profile_role_text text;
  v_role_permissions jsonb;
  v_profiles_role_type text := private.profiles_role_column_type();
  normalized_code text := upper(trim(office_code_input));
  normalized_email text := lower(trim(member_email));
  normalized_name text := trim(member_name);
begin
  perform set_config('row_security', 'off', true);
  perform set_config('app.office_provisioning', 'on', true);

  if char_length(normalized_name) < 2 then
    raise exception 'Member name must be at least 2 characters'
      using errcode = 'check_violation';
  end if;

  if normalized_code = '' or not public.is_valid_firm_code_format(normalized_code) then
    raise exception 'Invalid firm code format'
      using errcode = 'check_violation';
  end if;

  if v_role_slug = '' or v_role_slug = 'firm_owner' then
    raise exception 'Invalid role selection'
      using errcode = 'check_violation';
  end if;

  select g.id into target_firm_id
  from public.get_office_by_firm_code(normalized_code) g
  limit 1;

  if target_firm_id is null then
    raise exception 'Firm code does not exist: %', normalized_code
      using errcode = 'no_data_found';
  end if;

  select fr.id, fr.permissions
  into v_firm_role_id, v_role_permissions
  from public.firm_roles fr
  where fr.firm_id = target_firm_id
    and fr.slug = v_role_slug
    and fr.slug <> 'firm_owner'
  limit 1;

  if v_firm_role_id is null then
    raise exception 'Role not found for this office: %', v_role_slug
      using errcode = 'no_data_found';
  end if;

  if exists (
    select 1
    from public.employees e
    where lower(e.email) = normalized_email
      and e.deleted_at is null
  ) then
    raise exception 'Email already registered as an employee'
      using errcode = 'unique_violation';
  end if;

  if exists (
    select 1
    from public.employees e
    where lower(e.email) = normalized_email
      and e.firm_id = target_firm_id
      and e.deleted_at is not null
      and e.status = 'disabled'
  ) then
    raise exception 'Previous membership request was rejected for this office'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.email) = normalized_email
      and p.deleted_at is null
  ) then
    raise exception 'Email already registered'
      using errcode = 'unique_violation';
  end if;

  v_legacy_role := case
    when v_role_slug in ('lawyer', 'managing_lawyer') then 'lawyer'::public.employee_role_enum
    else 'assistant'::public.employee_role_enum
  end;

  v_profile_role_text := public.profile_role_from_employee_role(v_legacy_role::text);

  insert into public.employees(
    auth_uid, firm_id, full_name, email, role, status,
    firm_role_id, individual_permissions
  )
  values (
    auth_user_id, target_firm_id, normalized_name, normalized_email, v_legacy_role,
    'pending_approval', v_firm_role_id, coalesce(v_role_permissions, '{}'::jsonb)
  )
  returning id into new_employee_id;

  if v_profiles_role_type = 'profile_role_enum' then
    insert into public.profiles(id, firm_id, employee_id, full_name, email, role)
    values (
      auth_user_id, target_firm_id, new_employee_id, normalized_name, normalized_email,
      v_profile_role_text::public.profile_role_enum
    );
  else
    insert into public.profiles(id, firm_id, employee_id, full_name, email, role)
    values (
      auth_user_id, target_firm_id, new_employee_id, normalized_name, normalized_email,
      v_legacy_role
    );
  end if;

  perform set_config('app.office_provisioning', 'off', true);
  return target_firm_id;
end;
$$;

revoke all on function public.create_office_member_profile(uuid, text, text, text, text) from public;
grant execute on function public.create_office_member_profile(uuid, text, text, text, text) to service_role;

-- Keep handle_new_user exception messages informative for Auth API consumers
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  meta jsonb;
  flow text;
  invite_token text;
  role_slug text;
begin
  perform set_config('row_security', 'off', true);

  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  flow := lower(trim(coalesce(meta->>'registration_flow', '')));
  invite_token := nullif(trim(coalesce(meta->>'invitation_token', '')), '');
  role_slug := nullif(trim(coalesce(meta->>'firm_role_slug', '')), '');

  if flow = 'office' then
    perform public.create_office_admin_profile(
      new.id,
      coalesce(nullif(trim(meta->>'office_name'), ''), nullif(trim(meta->>'company'), ''), 'مكتب محاماة'),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      nullif(trim(meta->>'phone'), '')
    );
    return new;
  end if;

  if flow in ('lawyer', 'office_member') then
    perform public.create_office_member_profile(
      new.id,
      coalesce(nullif(trim(meta->>'firm_code'), ''), nullif(trim(meta->>'office_code'), ''), ''),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      coalesce(role_slug, 'lawyer')
    );
    return new;
  end if;

  if flow = 'invite' and invite_token is not null then
    perform public.create_invited_profile(
      new.id,
      invite_token,
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  raise exception 'registration_not_allowed'
    using hint = 'Use office registration, firm code, or invitation link.';
exception
  when others then
    raise exception 'Signup provisioning failed: %', sqlerrm using errcode = sqlstate;
end;
$$;

revoke all on function public.handle_new_user() from public;
