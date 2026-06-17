-- Super-admin billing, platform bank details, audit logs on approval, proof_of_payment_url

-- ─── Super admin check (employees.role = super_admin) ────────────────────────
create or replace function private.is_subscription_super_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_uid = auth.uid()
      and e.role = 'super_admin'
      and e.deleted_at is null
      and e.status = 'active'
  );
$$;

create or replace function public.is_subscription_super_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_subscription_super_admin();
$$;

revoke all on function private.is_subscription_super_admin() from public;
revoke all on function public.is_subscription_super_admin() from public;
grant execute on function public.is_subscription_super_admin() to authenticated, service_role;

-- ─── payments.proof_of_payment_url ───────────────────────────────────────────
alter table public.payments
  add column if not exists proof_of_payment_url text;

update public.payments
set proof_of_payment_url = coalesce(proof_of_payment_url, receipt_url)
where proof_of_payment_url is null and receipt_url is not null;

create or replace function public.sync_payment_proof_url()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.proof_of_payment_url is null and new.receipt_url is not null then
    new.proof_of_payment_url := new.receipt_url;
  elsif new.receipt_url is null and new.proof_of_payment_url is not null then
    new.receipt_url := new.proof_of_payment_url;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_payment_proof_url on public.payments;
create trigger trg_sync_payment_proof_url
  before insert or update of receipt_url, proof_of_payment_url on public.payments
  for each row execute function public.sync_payment_proof_url();

-- ─── Platform bank details (singleton) ─────────────────────────────────────────
create table if not exists public.platform_bank_details (
  id smallint primary key default 1 check (id = 1),
  bank_name text not null,
  account_name text not null,
  account_number text,
  iban text not null,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_bank_details (id, bank_name, account_name, account_number, iban, note)
values (
  1,
  'بنك الكريمي للتمويل الأصغر الإسلامي',
  'LegalMind Yemen',
  '0000-0000-0000-0000',
  'YE00BKRM00000000000000000000',
  'يرجى كتابة اسم المكتب في خانة الملاحظات عند التحويل.'
)
on conflict (id) do nothing;

alter table public.platform_bank_details enable row level security;

drop policy if exists "platform_bank_details_select" on public.platform_bank_details;
create policy "platform_bank_details_select" on public.platform_bank_details
  for select
  to authenticated
  using (true);

-- Writes only via RPC (super_admin)

create or replace function public.get_platform_bank_details()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bankName', bank_name,
    'accountName', account_name,
    'accountNumber', coalesce(account_number, ''),
    'iban', iban,
    'note', coalesce(note, '')
  )
  from public.platform_bank_details
  where id = 1;
$$;

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
set search_path = public
as $$
begin
  if not (select private.is_subscription_super_admin()) then
    raise exception 'not_authorized';
  end if;

  if char_length(trim(p_bank_name)) < 2 then
    raise exception 'invalid_bank_name';
  end if;
  if char_length(trim(p_account_name)) < 2 then
    raise exception 'invalid_account_name';
  end if;
  if char_length(trim(p_iban)) < 8 then
    raise exception 'invalid_iban';
  end if;

  insert into public.platform_bank_details (
    id, bank_name, account_name, account_number, iban, note, updated_by, updated_at
  )
  values (
    1,
    trim(p_bank_name),
    trim(p_account_name),
    nullif(trim(p_account_number), ''),
    trim(p_iban),
    nullif(trim(p_note), ''),
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

revoke all on function public.get_platform_bank_details() from public;
revoke all on function public.upsert_platform_bank_details(text, text, text, text, text) from public;
grant execute on function public.get_platform_bank_details() to authenticated, anon;
grant execute on function public.upsert_platform_bank_details(text, text, text, text, text) to authenticated;

-- ─── Audit helper for subscription reviews ───────────────────────────────────
create or replace function private.log_subscription_audit(
  p_table_name text,
  p_record_id uuid,
  p_operation text,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
begin
  select e.id into v_employee_id
  from public.employees e
  where e.auth_uid = auth.uid()
    and e.deleted_at is null
  limit 1;

  insert into public.audit_logs (table_name, record_id, operation, changed_by, changes)
  values (p_table_name, p_record_id, p_operation, v_employee_id, p_changes);
end;
$$;

-- ─── Review RPC: super_admin + audit logs ────────────────────────────────────
create or replace function public.review_subscription_request(
  p_request_id uuid,
  p_action text,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  if not (select private.is_subscription_super_admin()) then
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
    set status = 'cancelled',
        updated_at = now()
    where id = v_sub_id;

    update public.subscription_requests
    set status = 'rejected',
        admin_notes = nullif(trim(p_admin_notes), ''),
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = p_request_id;

    perform private.log_subscription_audit(
      'payments',
      v_pay_id,
      'UPDATE',
      jsonb_build_object(
        'action', 'subscription_rejected',
        'request_id', p_request_id,
        'firm_id', v_req.firm_id,
        'rejection_reason', nullif(trim(p_admin_notes), '')
      )
    );

    insert into public.notifications (firm_id, employee_id, title, message, type)
    values (
      v_req.firm_id,
      null,
      'تم رفض طلب الاشتراك',
      coalesce(nullif(trim(p_admin_notes), ''), 'يرجى التواصل مع الدعم الفني.'),
      'system'
    );

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

  v_new_expires := v_base + (v_days || ' days')::interval;

  perform set_config('app.subscription_bypass', 'on', true);

  update public.subscriptions
  set status = 'active',
      start_date = v_base,
      end_date = v_new_expires,
      plan_type = v_plan_type,
      updated_at = now()
  where id = v_sub_id;

  update public.payments
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      rejection_reason = null,
      proof_of_payment_url = coalesce(proof_of_payment_url, v_proof_url)
  where id = v_pay_id;

  update public.firms
  set subscription_status = 'active',
      subscription_plan = v_req.plan,
      subscription_expires_at = v_new_expires,
      is_locked = false,
      plan = v_req.plan
  where id = v_req.firm_id;

  update public.subscription_requests
  set status = 'approved',
      admin_notes = nullif(trim(p_admin_notes), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_request_id;

  perform private.log_subscription_audit(
    'subscriptions',
    v_sub_id,
    'INSERT',
    jsonb_build_object(
      'action', 'subscription_approved',
      'payment_id', v_pay_id,
      'request_id', p_request_id,
      'firm_id', v_req.firm_id,
      'plan', v_req.plan,
      'plan_type', v_plan_type,
      'expires_at', v_new_expires,
      'amount', v_req.amount_yer
    )
  );

  insert into public.notifications (firm_id, employee_id, title, message, type)
  values (
    v_req.firm_id,
    null,
    'تم تفعيل الاشتراك',
    format('تمت الموافقة على باقتك (%s). صالحة حتى %s.', v_req.plan, to_char(v_new_expires, 'YYYY-MM-DD')),
    'system'
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'approved',
    'expires_at', v_new_expires,
    'plan', v_req.plan,
    'payment_id', v_pay_id,
    'subscription_id', v_sub_id
  );
end;
$$;

create or replace function public.review_payment(
  p_payment_id uuid,
  p_action text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if not (select private.is_subscription_super_admin()) then
    raise exception 'not_authorized';
  end if;

  select sr.id into v_request_id
  from public.subscription_requests sr
  where sr.payment_id = p_payment_id
  limit 1;

  if v_request_id is null then
    raise exception 'request_not_found';
  end if;

  return public.review_subscription_request(v_request_id, p_action, p_rejection_reason);
end;
$$;

-- ─── RLS: super_admin sees all subscription requests & payments ──────────────
drop policy if exists "subscription_requests_select" on public.subscription_requests;
create policy "subscription_requests_select" on public.subscription_requests
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_platform_operator())
    or (select private.is_subscription_super_admin())
  );

drop policy if exists "payments_select" on public.payments;
create policy "payments_select" on public.payments
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_platform_operator())
    or (select private.is_subscription_super_admin())
  );

drop policy if exists "subscriptions_select" on public.subscriptions;
create policy "subscriptions_select" on public.subscriptions
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_platform_operator())
    or (select private.is_subscription_super_admin())
  );

grant execute on function public.review_subscription_request(uuid, text, text) to authenticated;
grant execute on function public.review_payment(uuid, text, text) to authenticated;
