-- Fix office owner provisioning: permissions, financial RLS grants, case soft-delete RETURNING

-- ─── 1) Allow role seeding during office signup (SECURITY DEFINER provisioning) ─
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

-- ─── 2) Provision firm_owner role + permissions on new office signup ───────────
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

-- Backfill existing office owners missing firm_role / permissions
insert into public.firm_roles (firm_id, name, slug, is_template, permissions)
select f.id, 'مالك المكتب', 'firm_owner', true, '{
  "cases.view":true,"cases.create":true,"cases.edit":true,"cases.delete":true,
  "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":true,
  "documents.upload":true,"documents.download":true,"documents.delete":true,
  "financials.view":true,"financials.add_payments":true,"financials.print_receipts":true,
  "sessions.view":true,"sessions.create":true,"sessions.edit":true,
  "users.invite":true,"users.manage":true,"users.permissions":true,
  "subscriptions.view":true,"subscriptions.manage":true,
  "settings.view":true,"settings.edit":true
}'::jsonb
from public.firms f
where f.deleted_at is null
  and not exists (
    select 1 from public.firm_roles fr
    where fr.firm_id = f.id and fr.slug = 'firm_owner'
  );

-- Backfill touches firm_role_id; bypass privilege guard (no auth context in migrations).
alter table public.employees disable trigger trg_guard_employee_privilege;

update public.employees e
set
  firm_role_id = fr.id,
  individual_permissions = coalesce(e.individual_permissions, fr.permissions)
from public.firm_roles fr
where fr.firm_id = e.firm_id
  and fr.slug = 'firm_owner'
  and e.deleted_at is null
  and e.role in ('firm_manager', 'admin', 'super_admin')
  and (e.firm_role_id is null or e.individual_permissions is null or e.individual_permissions = '{}'::jsonb);

alter table public.employees enable trigger trg_guard_employee_privilege;

-- ─── 3) Re-grant financial RLS helpers (dropped in migration 081) ─────────────
grant execute on function private.can_view_case_financials(uuid) to authenticated, service_role;
grant execute on function private.can_manage_case_financials(uuid) to authenticated, service_role;

-- ─── 4) Case soft-delete: allow RETURNING after deleted_at is set ─────────────
drop policy if exists "cases_select" on public.cases;

create policy "cases_select" on public.cases
  for select
  to authenticated
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and (
      (
        deleted_at is null
        and (
          (select private.is_office_admin())
          or (select private.get_current_role()) = 'assistant'
          or (
            (select private.get_current_role()) = 'lawyer'
            and assigned_lawyer_id is not null
            and assigned_lawyer_id = (select private.get_current_lawyer_id())
          )
        )
      )
      or (
        deleted_at is not null
        and (select private.is_office_admin())
      )
    )
  );

-- cases_update: allow soft-delete (omit deleted_at is null on USING, like expenses 037)
drop policy if exists "cases_update" on public.cases;

create policy "cases_update" on public.cases
  for update
  to authenticated
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and (
      (select private.is_office_admin())
      or (select private.has_permission('cases.edit'))
      or (
        (select private.get_current_role()) = 'assistant'
        and deleted_at is null
      )
      or (
        (select private.get_current_role()) = 'lawyer'
        and deleted_at is null
        and assigned_lawyer_id is not null
        and assigned_lawyer_id = (select private.get_current_lawyer_id())
      )
    )
  )
  with check (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
  );
