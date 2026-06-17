-- Login repair (no duplicate firms) + payment approval (billing admin + receipt access)

-- Helper: upsert profile row for a linked employee (handles both role enum column types)
create or replace function private.upsert_profile_for_employee(
  p_uid uuid,
  p_employee public.employees,
  p_email text,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role_text text := public.profile_role_from_employee_role(p_employee.role::text);
  v_col_type text := private.profiles_role_column_type();
begin
  if v_col_type = 'profile_role_enum' then
    insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
    values (
      p_uid,
      p_employee.firm_id,
      p_employee.id,
      coalesce(nullif(trim(p_employee.full_name), ''), p_full_name),
      coalesce(nullif(trim(p_employee.email), ''), p_email),
      v_role_text::public.profile_role_enum,
      p_employee.phone
    )
    on conflict (id) do update
      set firm_id = excluded.firm_id,
          employee_id = excluded.employee_id,
          full_name = excluded.full_name,
          email = excluded.email,
          role = excluded.role,
          phone = excluded.phone,
          deleted_at = null,
          updated_at = now();
  else
    insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
    values (
      p_uid,
      p_employee.firm_id,
      p_employee.id,
      coalesce(nullif(trim(p_employee.full_name), ''), p_full_name),
      coalesce(nullif(trim(p_employee.email), ''), p_email),
      v_role_text::public.employee_role_enum,
      p_employee.phone
    )
    on conflict (id) do update
      set firm_id = excluded.firm_id,
          employee_id = excluded.employee_id,
          full_name = excluded.full_name,
          email = excluded.email,
          role = excluded.role,
          phone = excluded.phone,
          deleted_at = null,
          updated_at = now();
  end if;
end;
$$;

-- One-time: missing profiles for linked employees
do $$
declare
  v_col_type text := private.profiles_role_column_type();
begin
  if v_col_type = 'profile_role_enum' then
    insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
    select
      u.id,
      e.firm_id,
      e.id,
      coalesce(nullif(trim(e.full_name), ''), split_part(u.email, '@', 1)),
      lower(trim(u.email)),
      public.profile_role_from_employee_role(e.role::text)::public.profile_role_enum,
      e.phone
    from auth.users u
    inner join public.employees e
      on e.deleted_at is null
     and e.auth_uid = u.id
    where not exists (
      select 1 from public.profiles p
      where p.id = u.id and p.deleted_at is null
    )
    on conflict (id) do update
      set firm_id = excluded.firm_id,
          employee_id = excluded.employee_id,
          deleted_at = null,
          updated_at = now();
  else
    insert into public.profiles (id, firm_id, employee_id, full_name, email, role, phone)
    select
      u.id,
      e.firm_id,
      e.id,
      coalesce(nullif(trim(e.full_name), ''), split_part(u.email, '@', 1)),
      lower(trim(u.email)),
      public.profile_role_from_employee_role(e.role::text)::public.employee_role_enum,
      e.phone
    from auth.users u
    inner join public.employees e
      on e.deleted_at is null
     and e.auth_uid = u.id
    where not exists (
      select 1 from public.profiles p
      where p.id = u.id and p.deleted_at is null
    )
    on conflict (id) do update
      set firm_id = excluded.firm_id,
          employee_id = excluded.employee_id,
          deleted_at = null,
          updated_at = now();
  end if;
end $$;

-- Ensure super_admin employees are platform operators
insert into private.platform_operators (auth_uid)
select distinct e.auth_uid
from public.employees e
where e.deleted_at is null
  and e.auth_uid is not null
  and e.role::text = 'super_admin'
on conflict (auth_uid) do nothing;

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
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    return jsonb_build_object('ok', true, 'action', 'profile_exists');
  end if;

  update public.profiles
  set deleted_at = null, updated_at = now()
  where id = v_uid and deleted_at is not null;

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
      set auth_uid = v_uid, status = 'active', updated_at = now()
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

revoke all on function public.repair_current_user_profile() from public;
grant execute on function public.repair_current_user_profile() to authenticated;

-- Payment approval: accept payment_id OR subscription_request id
create or replace function public.review_payment(
  p_payment_id uuid,
  p_action text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request_id uuid;
begin
  if not (select private.is_billing_admin()) then
    raise exception 'not_authorized';
  end if;

  select sr.id into v_request_id
  from public.subscription_requests sr
  where sr.payment_id = p_payment_id
     or sr.id = p_payment_id
  order by sr.created_at desc
  limit 1;

  if v_request_id is null then
    raise exception 'request_not_found';
  end if;

  return public.review_subscription_request(v_request_id, p_action, p_rejection_reason);
end;
$$;

create or replace function public.review_subscription_request(
  p_request_id uuid,
  p_action text,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_req public.subscription_requests%rowtype;
  v_days integer;
  v_base timestamptz;
  v_new_expires timestamptz;
  v_plan_type text;
  v_sub_id uuid;
  v_pay_id uuid;
  v_proof_url text;
begin
  if not (select private.is_billing_admin()) then
    raise exception 'not_authorized';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
  end if;

  if p_action = 'reject' and coalesce(nullif(trim(p_admin_notes), ''), '') = '' then
    raise exception 'rejection_reason_required';
  end if;

  select * into v_req
  from public.subscription_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  v_plan_type := public.map_plan_to_plan_type(v_req.plan);
  v_sub_id := v_req.subscription_id;
  v_pay_id := v_req.payment_id;
  v_proof_url := coalesce(v_req.receipt_url, null);

  if v_sub_id is null or v_pay_id is null then
    insert into public.subscriptions (firm_id, plan_type, status, start_date, end_date)
    values (v_req.firm_id, v_plan_type, 'pending', null, null)
    returning id into v_sub_id;

    insert into public.payments (
      firm_id, subscription_id, amount, payment_method, receipt_url, proof_of_payment_url, status
    )
    values (
      v_req.firm_id, v_sub_id, v_req.amount_yer, 'bank_transfer', v_proof_url, v_proof_url, 'pending'
    )
    returning id into v_pay_id;

    update public.subscription_requests
    set subscription_id = v_sub_id,
        payment_id = v_pay_id
    where id = p_request_id;
  end if;

  if p_action = 'reject' then
    update public.payments
    set status = 'rejected',
        rejection_reason = nullif(trim(p_admin_notes), ''),
        approved_by = auth.uid(),
        approved_at = now()
    where id = v_pay_id;

    update public.subscriptions
    set status = 'cancelled', updated_at = now()
    where id = v_sub_id;

    update public.subscription_requests
    set status = 'rejected',
        admin_notes = nullif(trim(p_admin_notes), ''),
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = p_request_id;

    return jsonb_build_object('ok', true, 'action', 'rejected', 'payment_id', v_pay_id);
  end if;

  v_days := public.saas_plan_duration_days(v_plan_type);

  select case
    when f.subscription_expires_at is not null and f.subscription_expires_at > now()
      then f.subscription_expires_at
    else now()
  end
  into v_base
  from public.firms f
  where f.id = v_req.firm_id;

  v_new_expires := v_base + make_interval(days => v_days);

  update public.payments
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = v_pay_id;

  update public.subscriptions
  set status = 'active',
      start_date = coalesce(start_date, now()),
      end_date = v_new_expires,
      updated_at = now()
  where id = v_sub_id;

  update public.subscription_requests
  set status = 'approved',
      admin_notes = nullif(trim(p_admin_notes), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_request_id;

  update public.firms
  set subscription_status = 'active',
      subscription_plan = v_plan_type,
      subscription_expires_at = v_new_expires,
      is_locked = false,
      plan = case v_plan_type when 'yearly' then 'enterprise' else 'pro' end,
      updated_at = now()
  where id = v_req.firm_id;

  insert into public.notifications (firm_id, employee_id, title, message, type)
  values (
    v_req.firm_id,
    null,
    'تم تفعيل الاشتراك',
    'تمت الموافقة على دفعتك وتفعيل باقة ' || v_plan_type || '.',
    'system'
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'approved',
    'payment_id', v_pay_id,
    'subscription_id', v_sub_id,
    'expires_at', v_new_expires
  );
end;
$$;

revoke all on function public.review_payment(uuid, text, text) from public;
grant execute on function public.review_payment(uuid, text, text) to authenticated;
revoke all on function public.review_subscription_request(uuid, text, text) from public;
grant execute on function public.review_subscription_request(uuid, text, text) to authenticated;

-- Billing admin can list/read all pending requests and receipts
drop policy if exists "subscription_requests_select" on public.subscription_requests;
create policy "subscription_requests_select" on public.subscription_requests
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_billing_admin())
  );

drop policy if exists "payments_select" on public.payments;
create policy "payments_select" on public.payments
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_billing_admin())
  );

drop policy if exists "subscriptions_select" on public.subscriptions;
create policy "subscriptions_select" on public.subscriptions
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_billing_admin())
  );

drop policy if exists "subscription_receipts_select_billing_admin" on storage.objects;
create policy "subscription_receipts_select_billing_admin" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'subscription-receipts'
    and (select private.is_billing_admin())
  );

-- First super_admin claim without blocking when profile is missing
create or replace function public.claim_billing_admin_setup()
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_employee public.employees%rowtype;
  v_has_admin boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select lower(trim(email)) into v_email
  from auth.users where id = v_uid;

  select exists (
    select 1 from public.employees e
    where e.role::text = 'super_admin'
      and e.deleted_at is null
      and e.status = 'active'
  )
  or exists (select 1 from private.platform_operators)
  into v_has_admin;

  if v_has_admin and not (select private.is_billing_admin()) then
    raise exception 'not_authorized';
  end if;

  select e.* into v_employee
  from public.employees e
  where e.deleted_at is null
    and (
      e.auth_uid = v_uid
      or (v_email is not null and lower(trim(coalesce(e.email, ''))) = v_email)
    )
  order by case when e.auth_uid = v_uid then 0 else 1 end, e.created_at desc
  limit 1;

  if not found then
    raise exception 'employee_not_found';
  end if;

  update public.employees
  set auth_uid = v_uid,
      role = 'super_admin',
      status = 'active',
      updated_at = now()
  where id = v_employee.id;

  select * into v_employee from public.employees where id = v_employee.id;

  perform private.upsert_profile_for_employee(
    v_uid,
    v_employee,
    coalesce(v_email, coalesce(v_employee.email, '')),
    coalesce(nullif(trim(v_employee.full_name), ''), split_part(coalesce(v_email, 'user'), '@', 1))
  );

  insert into private.platform_operators (auth_uid)
  values (v_uid)
  on conflict (auth_uid) do nothing;

  return jsonb_build_object(
    'ok', true,
    'auth_uid', v_uid,
    'employee_id', v_employee.id
  );
end;
$$;

revoke all on function public.claim_billing_admin_setup() from public;
grant execute on function public.claim_billing_admin_setup() to authenticated;
