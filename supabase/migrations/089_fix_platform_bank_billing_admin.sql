-- Fix platform bank save: billing admin sync, claim flow, get_current_role super_admin

-- ─── 1) get_current_role: honor profile super_admin / firm_manager ─────────────
create or replace function private.get_current_role()
returns public.employee_role_enum
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select coalesce(
    (
      select e.role
      from public.profiles p
      join public.employees e on e.id = p.employee_id and e.deleted_at is null
      where p.id = (select auth.uid()) and p.deleted_at is null
      limit 1
    ),
    (
      select e.role
      from public.employees e
      where e.auth_uid = (select auth.uid()) and e.deleted_at is null
      limit 1
    ),
    (
      select case p.role::text
        when 'super_admin' then 'super_admin'::public.employee_role_enum
        when 'lawyer' then 'lawyer'::public.employee_role_enum
        when 'assistant' then 'assistant'::public.employee_role_enum
        when 'admin' then 'firm_manager'::public.employee_role_enum
        when 'firm_manager' then 'firm_manager'::public.employee_role_enum
        else null::public.employee_role_enum
      end
      from public.profiles p
      where p.id = (select auth.uid()) and p.deleted_at is null
      limit 1
    )
  );
$$;

-- ─── 2) is_billing_admin: firm_manager platform owner path ───────────────────
create or replace function private.is_billing_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select coalesce(
    (select private.get_current_role()) = 'super_admin'::public.employee_role_enum,
    false
  )
  or exists (
    select 1
    from private.platform_operators po
    where po.auth_uid = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text in ('super_admin', 'admin', 'firm_manager')
      and exists (
        select 1
        from public.employees e
        where e.auth_uid = p.id
          and e.deleted_at is null
          and e.status = 'active'
      )
  );
$$;

create or replace function private.is_subscription_super_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_billing_admin();
$$;

create or replace function public.is_billing_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_billing_admin();
$$;

create or replace function public.is_subscription_super_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_billing_admin();
$$;

revoke all on function public.is_billing_admin() from public;
revoke all on function public.is_subscription_super_admin() from public;
grant execute on function public.is_billing_admin() to authenticated, service_role;
grant execute on function public.is_subscription_super_admin() to authenticated, service_role;

-- ─── 3) Auto-repair billing access for platform owner profile ────────────────
create or replace function public.ensure_platform_billing_access()
returns boolean
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  if (select private.is_billing_admin()) then
    return true;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.role::text in ('super_admin', 'admin', 'firm_manager')
  ) then
    return false;
  end if;

  update public.employees e
  set role = 'super_admin',
      status = 'active',
      updated_at = now()
  where e.auth_uid = v_uid
    and e.deleted_at is null;

  insert into private.platform_operators (auth_uid)
  values (v_uid)
  on conflict (auth_uid) do nothing;

  return true;
end;
$$;

revoke all on function public.ensure_platform_billing_access() from public;
grant execute on function public.ensure_platform_billing_access() to authenticated;

-- ─── 4) claim_billing_admin_setup: allow profile super_admin repair ──────────
create or replace function public.claim_billing_admin_setup()
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_employee_id uuid;
  v_profile_super boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if (select private.is_billing_admin()) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.role::text in ('super_admin', 'admin', 'firm_manager')
  )
  into v_profile_super;

  if not v_profile_super
     and exists (select 1 from private.platform_operators po where po.auth_uid <> v_uid) then
    raise exception 'not_authorized';
  end if;

  select e.id into v_employee_id
  from public.employees e
  where e.auth_uid = v_uid
    and e.deleted_at is null
  order by e.created_at desc
  limit 1;

  if v_employee_id is null then
    raise exception 'employee_not_found';
  end if;

  update public.employees
  set role = 'super_admin',
      status = 'active',
      updated_at = now()
  where id = v_employee_id;

  insert into private.platform_operators (auth_uid)
  values (v_uid)
  on conflict (auth_uid) do nothing;

  return jsonb_build_object(
    'ok', true,
    'auth_uid', v_uid,
    'employee_id', v_employee_id
  );
end;
$$;

revoke all on function public.claim_billing_admin_setup() from public;
grant execute on function public.claim_billing_admin_setup() to authenticated;

-- ─── 5) upsert_platform_bank_details: repair + authorize ─────────────────────
create or replace function public.upsert_platform_bank_details(
  p_bank_name text,
  p_account_name text,
  p_iban text,
  p_account_number text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  perform public.ensure_platform_billing_access();

  if not (select private.is_billing_admin()) then
    raise exception 'not_authorized';
  end if;

  if char_length(trim(coalesce(p_bank_name, ''))) < 2 then
    raise exception 'invalid_bank_name';
  end if;
  if char_length(trim(coalesce(p_account_name, ''))) < 2 then
    raise exception 'invalid_account_name';
  end if;
  if char_length(trim(coalesce(p_iban, ''))) < 8 then
    raise exception 'invalid_iban';
  end if;

  insert into public.platform_bank_details (
    id, bank_name, account_name, account_number, iban, note, updated_by, updated_at
  )
  values (
    1,
    trim(p_bank_name),
    trim(p_account_name),
    nullif(trim(coalesce(p_account_number, '')), ''),
    trim(p_iban),
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now()
  )
  on conflict (id) do update set
    bank_name = excluded.bank_name,
    account_name = excluded.account_name,
    account_number = excluded.account_number,
    iban = excluded.iban,
    note = excluded.note,
    updated_by = excluded.updated_by,
    updated_at = now();

  return public.get_platform_bank_details();
end;
$$;

revoke all on function public.upsert_platform_bank_details(text, text, text, text, text) from public;
grant execute on function public.upsert_platform_bank_details(text, text, text, text, text) to authenticated;

-- Repair known platform owner if present
insert into private.platform_operators (auth_uid)
select u.id
from auth.users u
where lower(trim(u.email)) in ('legalmind.yemen@gmail.com', 'legalmind@yemen.com')
on conflict (auth_uid) do nothing;

update public.employees e
set role = 'super_admin'::public.employee_role_enum,
    status = 'active',
    updated_at = now()
from auth.users u
where e.auth_uid = u.id
  and e.deleted_at is null
  and lower(trim(u.email)) in ('legalmind.yemen@gmail.com', 'legalmind@yemen.com')
  and e.role is distinct from 'super_admin'::public.employee_role_enum;
