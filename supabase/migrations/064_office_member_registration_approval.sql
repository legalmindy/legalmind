-- Office member self-registration with firm role selection + owner approval

alter type public.employee_status_enum add value if not exists 'pending_approval';

-- Roles available when joining via firm code (excludes office owner)
create or replace function public.get_firm_roles_for_registration(office_code_input text)
returns table (
  slug text,
  name text
)
language sql
stable
security definer
set search_path = public
as $$
  select fr.slug, fr.name
  from public.firm_roles fr
  join public.get_office_by_firm_code(upper(trim(office_code_input))) g on g.id = fr.firm_id
  where fr.is_template = true
    and fr.slug <> 'firm_owner'
  order by
    case fr.slug
      when 'managing_lawyer' then 1
      when 'lawyer' then 2
      when 'legal_assistant' then 3
      when 'secretary' then 4
      when 'accountant' then 5
      else 99
    end,
    fr.name;
$$;

revoke all on function public.get_firm_roles_for_registration(text) from public;
grant execute on function public.get_firm_roles_for_registration(text) to anon, authenticated;

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
set search_path = public
as $$
declare
  target_firm_id uuid;
  new_employee_id uuid;
  v_firm_role_id uuid;
  v_role_slug text := lower(trim(coalesce(firm_role_slug_input, 'lawyer')));
  v_legacy_role public.employee_role_enum;
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

  select fr.id into v_firm_role_id
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
    select 1 from profiles p
    where lower(p.email) = normalized_email and p.deleted_at is null
  ) then
    raise exception 'Email already registered' using errcode = 'unique_violation';
  end if;

  v_legacy_role := case
    when v_role_slug in ('lawyer', 'managing_lawyer') then 'lawyer'::public.employee_role_enum
    else 'assistant'::public.employee_role_enum
  end;

  insert into employees(auth_uid, firm_id, full_name, email, role, status, firm_role_id)
  values (auth_user_id, target_firm_id, normalized_name, normalized_email, v_legacy_role, 'pending_approval', v_firm_role_id)
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role)
  values (auth_user_id, target_firm_id, new_employee_id, normalized_name, normalized_email, v_legacy_role);

  return target_firm_id;
end;
$$;

revoke all on function public.create_office_member_profile(uuid, text, text, text, text) from public;
grant execute on function public.create_office_member_profile(uuid, text, text, text, text) to service_role;

-- Backward-compatible alias used by older migrations
create or replace function public.create_lawyer_profile(
  auth_user_id uuid,
  office_code_input text,
  lawyer_name text,
  lawyer_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_office_member_profile(
    auth_user_id,
    office_code_input,
    lawyer_name,
    lawyer_email,
    'lawyer'
  );
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
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
    perform create_office_admin_profile(
      new.id,
      coalesce(nullif(trim(meta->>'office_name'), ''), nullif(trim(meta->>'company'), ''), 'مكتب محاماة'),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      nullif(trim(meta->>'phone'), '')
    );
    return new;
  end if;

  if flow in ('lawyer', 'office_member') then
    perform create_office_member_profile(
      new.id,
      coalesce(nullif(trim(meta->>'firm_code'), ''), nullif(trim(meta->>'office_code'), ''), ''),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      coalesce(role_slug, 'lawyer')
    );
    return new;
  end if;

  if flow = 'invite' and invite_token is not null then
    perform create_invited_profile(
      new.id,
      invite_token,
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  perform create_office_admin_profile(
    new.id,
    coalesce(nullif(trim(meta->>'company'), ''), 'مكتب محاماة'),
    coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(trim(meta->>'phone'), '')
  );
  return new;
exception
  when others then
    raise exception 'Signup provisioning failed: %', sqlerrm using errcode = sqlstate;
end;
$$;

create or replace function public.list_pending_member_registrations()
returns table (
  employee_id uuid,
  full_name text,
  email text,
  role_slug text,
  role_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
begin
  if not private.is_office_admin() then
    raise exception 'not_authorized';
  end if;

  v_firm_id := private.get_current_firm_id();

  return query
  select
    e.id,
    e.full_name,
    e.email,
    fr.slug,
    fr.name,
    e.created_at
  from public.employees e
  left join public.firm_roles fr on fr.id = e.firm_role_id
  where e.firm_id = v_firm_id
    and e.deleted_at is null
    and e.status = 'pending_approval'
  order by e.created_at asc;
end;
$$;

revoke all on function public.list_pending_member_registrations() from public;
grant execute on function public.list_pending_member_registrations() to authenticated;

create or replace function public.approve_member_registration(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
  v_employee record;
begin
  if not private.is_office_admin() then
    raise exception 'not_authorized';
  end if;

  v_firm_id := private.get_current_firm_id();

  select e.*, fr.slug as role_slug
  into v_employee
  from public.employees e
  left join public.firm_roles fr on fr.id = e.firm_role_id
  where e.id = p_employee_id
    and e.firm_id = v_firm_id
    and e.deleted_at is null
    and e.status = 'pending_approval'
  for update;

  if not found then
    raise exception 'member_not_pending';
  end if;

  update public.employees
  set status = 'active', updated_at = now()
  where id = p_employee_id;

  if v_employee.role = 'lawyer' or coalesce(v_employee.role_slug, '') in ('lawyer', 'managing_lawyer') then
    insert into public.lawyers(employee_id)
    values (p_employee_id)
    on conflict (employee_id) do nothing;
  end if;
end;
$$;

revoke all on function public.approve_member_registration(uuid) from public;
grant execute on function public.approve_member_registration(uuid) to authenticated;

create or replace function public.reject_member_registration(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
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
    and status = 'pending_approval';

  if not found then
    raise exception 'member_not_pending';
  end if;
end;
$$;

revoke all on function public.reject_member_registration(uuid) from public;
grant execute on function public.reject_member_registration(uuid) to authenticated;

-- Block pending members from permission checks
create or replace function private.has_permission(perm_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = private, public
as $$
declare
  v_perm boolean;
  v_role text;
  v_status text;
begin
  if perm_key is null or perm_key = '' then return false; end if;

  select e.status into v_status
  from public.employees e
  where e.auth_uid = auth.uid() and e.deleted_at is null
  limit 1;

  if v_status = 'pending_approval' then return false; end if;

  select (fr.permissions ->> perm_key)::boolean
  into v_perm
  from public.employees e
  join public.firm_roles fr on fr.id = e.firm_role_id
  where e.auth_uid = auth.uid()
    and e.deleted_at is null
    and e.status = 'active'
  limit 1;

  if v_perm is not null then return v_perm; end if;

  v_role := private.get_current_role()::text;
  return case perm_key
    when 'financials.view' then v_role in ('super_admin','admin','firm_manager','lawyer','assistant')
    when 'financials.add_payments' then v_role in ('super_admin','admin','firm_manager')
    else private.is_office_admin()
  end;
end;
$$;
