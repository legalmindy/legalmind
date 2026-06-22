-- Allow inviting/editing employees with any firm role except office owner (firm_owner)

alter table public.invitations
  add column if not exists firm_role_id uuid references public.firm_roles(id) on delete set null;

create or replace function private.employee_role_from_firm_slug(p_slug text)
returns public.employee_role_enum
language sql
immutable
as $$
  select case
    when p_slug in ('lawyer', 'managing_lawyer') then 'lawyer'::public.employee_role_enum
    else 'assistant'::public.employee_role_enum
  end;
$$;

create or replace function public.create_office_invitation(
  invite_email text,
  invite_role text default null,
  app_origin text default null,
  invite_full_name text default null,
  invite_phone text default null,
  invite_firm_role_id uuid default null
)
returns table (id uuid, email text, role text, status text, expires_at timestamptz, invite_url text)
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  raw_token text;
  hashed_token text;
  new_invitation public.invitations%rowtype;
  base_url text;
  normalized_email text;
  v_firm_id uuid;
  v_role_slug text;
  v_role_permissions jsonb;
  v_employee_role public.employee_role_enum;
begin
  perform public.expire_old_invitations();

  if not (select private.is_firm_manager()) then
    raise exception 'Only firm admins can create invitations';
  end if;

  v_firm_id := private.get_current_firm_id();
  normalized_email := lower(trim(invite_email));

  if normalized_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
    raise exception 'invalid_email';
  end if;

  if invite_firm_role_id is not null then
    select fr.slug, fr.permissions
    into v_role_slug, v_role_permissions
    from public.firm_roles fr
    where fr.id = invite_firm_role_id
      and fr.firm_id = v_firm_id;

    if v_role_slug is null then
      raise exception 'Invalid role';
    end if;

    if v_role_slug = 'firm_owner' then
      raise exception 'Invalid role';
    end if;

    v_employee_role := private.employee_role_from_firm_slug(v_role_slug);
  else
    if invite_role not in ('lawyer', 'assistant') then
      raise exception 'Invalid role';
    end if;

    v_employee_role := invite_role::public.employee_role_enum;

    select fr.id, fr.slug, fr.permissions
    into invite_firm_role_id, v_role_slug, v_role_permissions
    from public.firm_roles fr
    where fr.firm_id = v_firm_id
      and fr.slug = case invite_role
        when 'lawyer' then 'lawyer'
        else 'legal_assistant'
      end
    limit 1;
  end if;

  raw_token := encode(public.secure_random_bytes(32), 'hex');
  hashed_token := public.invitation_hash(raw_token);
  base_url := coalesce(nullif(trim(app_origin), ''), 'https://app.com');

  insert into public.invitations (
    firm_id, email, full_name, phone, role, firm_role_id, status, token_hash, invited_by, expires_at, invite_url
  )
  values (
    v_firm_id,
    normalized_email,
    nullif(trim(invite_full_name), ''),
    nullif(trim(invite_phone), ''),
    v_employee_role,
    invite_firm_role_id,
    'pending',
    hashed_token,
    private.get_current_employee_id(),
    now() + interval '7 days',
    base_url || '/invite/' || raw_token
  )
  returning * into new_invitation;

  return query
  select
    new_invitation.id,
    new_invitation.email,
    new_invitation.role::text,
    new_invitation.status,
    new_invitation.expires_at,
    new_invitation.invite_url;
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
begin
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
      inv.phone,
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
        phone = coalesce(inv.phone, phone),
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

  insert into public.profiles (id, firm_id, employee_id, full_name, email, role)
  values (
    auth.uid(),
    inv.firm_id,
    target_employee_id,
    coalesce(inv.full_name, split_part(inv.email, '@', 1)),
    inv.email,
    profile_role
  )
  on conflict (id) do update
    set firm_id = excluded.firm_id,
        employee_id = excluded.employee_id,
        full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        deleted_at = null;

  update public.invitations
  set status = 'accepted',
      accepted_at = now(),
      employee_id = target_employee_id
  where id = inv.id;

  return target_employee_id;
end;
$$;

create or replace function public.apply_firm_role_to_employee(
  p_employee_id uuid,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
  v_perms jsonb;
  v_role_slug text;
  v_employee_role public.employee_role_enum;
begin
  v_firm_id := private.get_current_firm_id();

  if not (private.is_office_admin() or private.has_permission('users.permissions')) then
    raise exception 'not_authorized';
  end if;

  select fr.permissions, fr.slug
  into v_perms, v_role_slug
  from public.firm_roles fr
  where fr.id = p_role_id
    and fr.firm_id = v_firm_id;

  if v_perms is null then
    raise exception 'role_not_found';
  end if;

  if v_role_slug = 'firm_owner' then
    raise exception 'cannot_assign_firm_owner';
  end if;

  v_employee_role := private.employee_role_from_firm_slug(v_role_slug);

  update public.employees e
  set firm_role_id = p_role_id,
      individual_permissions = v_perms,
      role = v_employee_role,
      updated_at = now()
  where e.id = p_employee_id
    and e.firm_id = v_firm_id
    and e.deleted_at is null;

  if not found then
    raise exception 'employee_not_found';
  end if;

  if v_employee_role = 'lawyer' or v_role_slug in ('lawyer', 'managing_lawyer') then
    insert into public.lawyers(employee_id)
    values (p_employee_id)
    on conflict (employee_id) do nothing;
  end if;
end;
$$;

revoke all on function public.create_office_invitation(text, text, text, text, text, uuid) from public;
grant execute on function public.create_office_invitation(text, text, text, text, text, uuid) to authenticated;
