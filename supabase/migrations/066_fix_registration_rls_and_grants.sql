-- Fix registration RPCs blocked by RLS (42501 get_current_firm_id) + restore private helper grants

-- ─── 1) Pre-auth RPCs: bypass RLS inside SECURITY DEFINER bodies ─────────────

create or replace function public.get_office_by_firm_code(firm_code_input text)
returns table(id uuid, name text, firm_code text)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  normalized text := private.normalize_firm_code(firm_code_input);
begin
  perform set_config('row_security', 'off', true);

  if not public.is_valid_firm_code_format(normalized) then
    return;
  end if;

  return query
  select f.id, f.name, f.firm_code::text
  from public.firms f
  where private.normalize_firm_code(f.firm_code) = normalized
    and f.deleted_at is null
  limit 1;
end;
$$;

create or replace function public.get_office_by_code(office_code_input text)
returns table(id uuid, name text, office_code text, firm_code text)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  perform set_config('row_security', 'off', true);

  return query
  select g.id, g.name, g.firm_code, g.firm_code
  from public.get_office_by_firm_code(office_code_input) g;
end;
$$;

create or replace function public.office_code_exists(office_code_input text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_exists boolean;
begin
  perform set_config('row_security', 'off', true);

  select exists (
    select 1 from public.get_office_by_firm_code(office_code_input)
  ) into v_exists;

  return coalesce(v_exists, false);
end;
$$;

create or replace function public.is_email_available_for_registration(check_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  normalized_email text := lower(trim(check_email));
  v_available boolean;
begin
  perform set_config('row_security', 'off', true);

  if normalized_email = '' then
    return false;
  end if;

  select not exists (
    select 1 from public.profiles p
    where lower(p.email) = normalized_email and p.deleted_at is null
  )
  and not exists (
    select 1 from public.employees e
    where lower(e.email) = normalized_email and e.deleted_at is null
  )
  into v_available;

  return coalesce(v_available, false);
end;
$$;

create or replace function public.get_firm_roles_for_registration(office_code_input text)
returns table (
  slug text,
  name text
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  perform set_config('row_security', 'off', true);

  return query
  select fr.slug, fr.name
  from public.firm_roles fr
  join public.get_office_by_firm_code(office_code_input) g on g.id = fr.firm_id
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
end;
$$;

-- ─── 2) Re-grant registration RPCs to anon + authenticated ───────────────────

grant execute on function public.get_office_by_firm_code(text) to anon, authenticated;
grant execute on function public.get_office_by_code(text) to anon, authenticated;
grant execute on function public.office_code_exists(text) to anon, authenticated;
grant execute on function public.is_email_available_for_registration(text) to anon, authenticated;
grant execute on function public.get_firm_roles_for_registration(text) to anon, authenticated;

-- ─── 3) authenticated must EXECUTE private helpers referenced in RLS policies ─

do $$
declare
  sig text;
begin
  foreach sig in array array[
    'private.get_current_firm_id()',
    'private.get_current_employee_id()',
    'private.get_current_profile_role()',
    'private.get_current_role()',
    'private.get_current_lawyer_id()',
    'private.is_office_profile_admin()',
    'private.is_office_admin()',
    'private.is_firm_manager()',
    'private.is_current_user_office_admin()',
    'private.is_firm_subscription_active()',
    'private.can_access_case(uuid)',
    'private.can_view_case_financials(uuid)',
    'private.can_manage_case_financials(uuid)',
    'private.has_permission(text)',
    'private.storage_case_id(text)',
    'private.is_platform_operator()',
    'private.is_billing_admin()',
    'private.is_subscription_super_admin()'
  ]
  loop
    begin
      execute format('revoke all on function %s from public', sig);
      execute format('revoke all on function %s from anon', sig);
      execute format('grant execute on function %s to authenticated, service_role', sig);
    exception
      when undefined_function then
        raise notice 'Skipped private helper: %', sig;
    end;
  end loop;
end $$;

grant usage on schema private to authenticated, service_role;
