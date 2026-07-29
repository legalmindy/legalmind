-- Fix office signup: restore provisioning functions that were stale on remote
-- (schema_migrations showed 086/087 applied, but function bodies remained at 004-era).
-- Symptom: auth/v1/signup → 500 "Database error saving new user"

create or replace function public.seed_firm_role_templates(p_firm_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(current_setting('app.office_provisioning', true), '') <> 'on' then
    if p_firm_id is distinct from private.get_current_firm_id()
       and not private.is_platform_operator() then
      raise exception 'not_authorized';
    end if;
  end if;

  insert into public.firm_roles (firm_id, name, slug, is_template, permissions)
  values
    (p_firm_id, 'مالك المكتب', 'firm_owner', true, '{
      "cases.view":true,"cases.create":true,"cases.edit":true,"cases.delete":true,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":true,
      "documents.upload":true,"documents.download":true,"documents.delete":true,
      "financials.view":true,"financials.add_payments":true,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":true,"users.manage":true,"users.permissions":true,
      "subscriptions.view":true,"subscriptions.manage":true,
      "settings.view":true,"settings.edit":true
    }'::jsonb),
    (p_firm_id, 'محامٍ أول', 'managing_lawyer', true, '{
      "cases.view":true,"cases.create":true,"cases.edit":true,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":true,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":true,"users.manage":false,"users.permissions":false,
      "subscriptions.view":true,"subscriptions.manage":false,
      "settings.view":true,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'محامٍ', 'lawyer', true, '{
      "cases.view":true,"cases.create":true,"cases.edit":true,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":false,"financials.print_receipts":false,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":false,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'مساعد قانوني', 'legal_assistant', true, '{
      "cases.view":true,"cases.create":false,"cases.edit":false,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":false,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":false,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'محاسب', 'accountant', true, '{
      "cases.view":true,"cases.create":false,"cases.edit":false,"cases.delete":false,
      "clients.view":true,"clients.create":false,"clients.edit":false,"clients.delete":false,
      "documents.upload":false,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":true,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":false,"sessions.edit":false,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":true,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'سكرتير', 'secretary', true, '{
      "cases.view":true,"cases.create":false,"cases.edit":false,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":false,"financials.add_payments":false,"financials.print_receipts":false,
      "sessions.view":true,"sessions.create":true,"sessions.edit":false,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":false,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb)
  on conflict (firm_id, slug) do nothing;
end;
$$;

create or replace function public.create_office_admin_profile(
  auth_user_id uuid,
  office_name text,
  owner_name text,
  owner_email text,
  owner_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  new_firm_id uuid;
  new_employee_id uuid;
  v_owner_role_id uuid;
  v_owner_perms jsonb;
  normalized_email text := lower(trim(owner_email));
  normalized_name text := trim(owner_name);
  normalized_phone text := normalize_yemeni_phone_for_storage(owner_phone);
  v_profiles_role_type text := private.profiles_role_column_type();
begin
  perform set_config('row_security', 'off', true);
  perform set_config('app.office_provisioning', 'on', true);

  if char_length(normalized_name) < 2 then
    raise exception 'Owner name must be at least 2 characters'
      using errcode = 'check_violation';
  end if;

  if normalized_phone is not null
     and normalized_phone !~ '^(77|73|71|70)[0-9]{7}$' then
    raise exception 'Invalid Yemeni phone number'
      using errcode = 'check_violation';
  end if;

  insert into public.firms(
    name, owner_full_name, email, phone, plan,
    subscription_status, subscription_plan, subscription_expires_at, is_locked
  )
  values (
    trim(office_name), normalized_name, normalized_email, normalized_phone, 'free',
    'trial', 'trial', now() + interval '30 days', false
  )
  returning id into new_firm_id;

  perform public.seed_firm_role_templates(new_firm_id);

  select fr.id, fr.permissions
  into v_owner_role_id, v_owner_perms
  from public.firm_roles fr
  where fr.firm_id = new_firm_id and fr.slug = 'firm_owner'
  limit 1;

  insert into public.employees(
    auth_uid, firm_id, full_name, email, phone, role, status,
    firm_role_id, individual_permissions
  )
  values (
    auth_user_id, new_firm_id, normalized_name, normalized_email, normalized_phone,
    'firm_manager', 'active', v_owner_role_id, coalesce(v_owner_perms, '{}'::jsonb)
  )
  returning id into new_employee_id;

  if v_profiles_role_type = 'profile_role_enum' then
    insert into public.profiles(id, firm_id, employee_id, full_name, email, role, phone)
    values (auth_user_id, new_firm_id, new_employee_id, normalized_name, normalized_email, 'admin', normalized_phone);
  else
    insert into public.profiles(id, firm_id, employee_id, full_name, email, role, phone)
    values (auth_user_id, new_firm_id, new_employee_id, normalized_name, normalized_email, 'firm_manager', normalized_phone);
  end if;

  perform set_config('app.office_provisioning', 'off', true);
  return new_firm_id;
end;
$$;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.create_office_admin_profile(uuid, text, text, text, text) from public;
grant execute on function public.create_office_admin_profile(uuid, text, text, text, text) to service_role;

revoke all on function public.seed_firm_role_templates(uuid) from public;
grant execute on function public.seed_firm_role_templates(uuid) to service_role;

revoke all on function public.handle_new_user() from public;
