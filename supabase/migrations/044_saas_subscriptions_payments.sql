-- Production SaaS subscription system: subscriptions + payments tables
-- Keeps subscription_requests for backward compatibility and audit trail.

-- ─── Plan helpers ────────────────────────────────────────────────────────────
create or replace function public.map_plan_to_plan_type(plan_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(plan_code, '')))
    when 'monthly' then 'monthly'
    when 'quarterly' then 'quarterly'
    when 'yearly' then 'yearly'
    when 'annual' then 'yearly'
    when 'trial' then 'monthly'
    else 'monthly'
  end;
$$;

create or replace function public.saas_plan_duration_days(plan_type text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case public.map_plan_to_plan_type(plan_type)
    when 'monthly' then 30
    when 'quarterly' then 90
    when 'yearly' then 365
    else 30
  end;
$$;

-- Keep legacy helper aligned with yearly naming
create or replace function public.subscription_plan_duration_days(plan_code text)
returns integer
language sql
immutable
set search_path = public
as $$
  select public.saas_plan_duration_days(plan_code);
$$;

-- ─── subscriptions ───────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  plan_type text not null
    check (plan_type in ('monthly', 'quarterly', 'yearly')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'expired', 'cancelled')),
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_dates_check check (
    start_date is null
    or end_date is null
    or end_date >= start_date
  )
);

create index if not exists idx_subscriptions_firm_created
  on public.subscriptions (firm_id, created_at desc);

create index if not exists idx_subscriptions_firm_status
  on public.subscriptions (firm_id, status);

create index if not exists idx_subscriptions_end_date
  on public.subscriptions (end_date)
  where status = 'active';

drop trigger if exists set_updated_at_subscriptions on public.subscriptions;
create trigger set_updated_at_subscriptions
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ─── payments ──────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  payment_method text not null default 'bank_transfer'
    check (char_length(trim(payment_method)) >= 2),
  receipt_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_firm_created
  on public.payments (firm_id, created_at desc);

create index if not exists idx_payments_subscription
  on public.payments (subscription_id);

create index if not exists idx_payments_status
  on public.payments (status)
  where status = 'pending';

create unique index if not exists idx_payments_one_pending_per_firm
  on public.payments (firm_id)
  where status = 'pending';

-- Link legacy requests to new tables
alter table public.subscription_requests
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete set null;

alter table public.subscription_requests
  add column if not exists payment_id uuid references public.payments(id) on delete set null;

create index if not exists idx_subscription_requests_payment
  on public.subscription_requests (payment_id);

create index if not exists idx_subscription_requests_subscription
  on public.subscription_requests (subscription_id);

-- ─── Expire subscriptions + sync firms ───────────────────────────────────────
create or replace function public.sync_firm_subscription_from_subscriptions(p_firm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  select *
  into v_sub
  from public.subscriptions s
  where s.firm_id = p_firm_id
    and s.status = 'active'
    and s.end_date is not null
    and s.end_date > now()
  order by s.end_date desc
  limit 1;

  if not found then
    return;
  end if;

  perform set_config('app.subscription_bypass', 'on', true);

  update public.firms f
  set subscription_status = 'active',
      subscription_plan = case v_sub.plan_type
        when 'yearly' then 'annual'
        else v_sub.plan_type
      end,
      subscription_expires_at = v_sub.end_date,
      is_locked = false,
      plan = case v_sub.plan_type
        when 'yearly' then 'annual'
        else v_sub.plan_type
      end
  where f.id = p_firm_id;
end;
$$;

create or replace function public.expire_stale_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  perform set_config('app.subscription_bypass', 'on', true);
  perform set_config('row_security', 'off', true);

  update public.subscriptions
  set status = 'expired',
      updated_at = now()
  where status = 'active'
    and end_date is not null
    and end_date <= now();

  get diagnostics v_count = row_count;

  for v_row in
    select distinct firm_id
    from public.subscriptions
    where status = 'expired'
      and end_date is not null
      and end_date <= now()
  loop
    update public.firms
    set subscription_status = 'expired',
        is_locked = true
    where id = v_row.firm_id
      and subscription_expires_at is not null
      and subscription_expires_at <= now()
      and subscription_status in ('trial', 'active');
  end loop;

  return v_count;
end;
$$;

create or replace function public.expire_stale_firm_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firm_count integer;
  v_sub_count integer;
begin
  v_sub_count := public.expire_stale_subscriptions();

  perform set_config('app.subscription_bypass', 'on', true);

  update public.firms
  set subscription_status = 'expired',
      is_locked = true
  where subscription_expires_at is not null
    and subscription_expires_at <= now()
    and subscription_status in ('trial', 'active')
    and not is_locked;

  get diagnostics v_firm_count = row_count;

  update public.subscriptions s
  set status = 'expired',
      updated_at = now()
  from public.firms f
  where s.firm_id = f.id
    and s.status = 'active'
    and f.subscription_expires_at is not null
    and f.subscription_expires_at <= now();

  return v_firm_count + v_sub_count;
end;
$$;

-- ─── Auto-provision payment + subscription for new requests ───────────────────
create or replace function public.provision_saas_records_for_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_type text;
  v_sub_id uuid;
  v_pay_id uuid;
begin
  if new.payment_id is not null and new.subscription_id is not null then
    return new;
  end if;

  v_plan_type := public.map_plan_to_plan_type(new.plan);

  insert into public.subscriptions (firm_id, plan_type, status, start_date, end_date)
  values (new.firm_id, v_plan_type, 'pending', null, null)
  returning id into v_sub_id;

  insert into public.payments (
    firm_id,
    subscription_id,
    amount,
    payment_method,
    receipt_url,
    status
  )
  values (
    new.firm_id,
    v_sub_id,
    new.amount_yer,
    'bank_transfer',
    new.receipt_url,
    case new.status
      when 'approved' then 'approved'
      when 'rejected' then 'rejected'
      else 'pending'
    end
  )
  returning id into v_pay_id;

  update public.subscription_requests
  set subscription_id = v_sub_id,
      payment_id = v_pay_id
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_provision_saas_records_for_request on public.subscription_requests;
create trigger trg_provision_saas_records_for_request
  after insert on public.subscription_requests
  for each row execute function public.provision_saas_records_for_request();

-- ─── Backfill existing data ────────────────────────────────────────────────────
insert into public.subscriptions (firm_id, plan_type, status, start_date, end_date, created_at)
select
  f.id,
  public.map_plan_to_plan_type(f.subscription_plan),
  case
    when f.subscription_status = 'expired' then 'expired'
    when f.subscription_status = 'active' then 'active'
    when f.subscription_status = 'trial' then 'active'
    else 'pending'
  end,
  coalesce(f.created_at, now()),
  f.subscription_expires_at,
  coalesce(f.created_at, now())
from public.firms f
where not exists (
  select 1 from public.subscriptions s where s.firm_id = f.id
);

insert into public.payments (
  firm_id,
  subscription_id,
  amount,
  payment_method,
  receipt_url,
  status,
  approved_by,
  approved_at,
  rejection_reason,
  created_at
)
select
  sr.firm_id,
  coalesce(
    sr.subscription_id,
    (
      select s.id
      from public.subscriptions s
      where s.firm_id = sr.firm_id
      order by s.created_at desc
      limit 1
    )
  ),
  sr.amount_yer,
  'bank_transfer',
  sr.receipt_url,
  case sr.status
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    else 'pending'
  end,
  sr.reviewed_by,
  sr.reviewed_at,
  case when sr.status = 'rejected' then sr.admin_notes else null end,
  sr.created_at
from public.subscription_requests sr
where sr.payment_id is null
  and exists (
    select 1 from public.subscriptions s where s.firm_id = sr.firm_id
  );

update public.subscription_requests sr
set payment_id = p.id
from public.payments p
where sr.payment_id is null
  and p.firm_id = sr.firm_id
  and p.created_at = sr.created_at
  and p.amount = sr.amount_yer;

update public.subscription_requests sr
set subscription_id = p.subscription_id
from public.payments p
where sr.subscription_id is null
  and sr.payment_id = p.id;

-- ─── Secure submit RPC ─────────────────────────────────────────────────────────
create or replace function public.submit_subscription_request(
  p_plan text,
  p_amount_yer numeric,
  p_transfer_reference text,
  p_receipt_path text,
  p_receipt_url text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firm_id uuid;
  v_user_id uuid := auth.uid();
  v_request_id uuid := coalesce(p_request_id, gen_random_uuid());
  v_plan text := lower(trim(p_plan));
  v_ref text := trim(p_transfer_reference);
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  v_firm_id := private.get_current_firm_id();
  if v_firm_id is null then
    raise exception 'firm_not_found';
  end if;

  if not (select private.is_office_admin()) then
    raise exception 'not_authorized';
  end if;

  if v_plan not in ('monthly', 'quarterly', 'annual') then
    raise exception 'invalid_plan';
  end if;

  if v_ref is null or char_length(v_ref) < 3 then
    raise exception 'invalid_transfer_reference';
  end if;

  if p_amount_yer is null or p_amount_yer < 0 then
    raise exception 'invalid_amount';
  end if;

  if p_receipt_path is null or char_length(trim(p_receipt_path)) < 3 then
    raise exception 'invalid_receipt_path';
  end if;

  if exists (
    select 1 from public.subscription_requests
    where firm_id = v_firm_id and status = 'pending'
  ) then
    raise exception 'pending_request_exists';
  end if;

  insert into public.subscription_requests (
    id,
    firm_id,
    submitted_by,
    plan,
    amount_yer,
    transfer_reference,
    receipt_path,
    receipt_url,
    status
  )
  values (
    v_request_id,
    v_firm_id,
    v_user_id,
    v_plan,
    p_amount_yer,
    v_ref,
    trim(p_receipt_path),
    nullif(trim(p_receipt_url), ''),
    'pending'
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id
  );
end;
$$;

-- ─── Review payment / subscription request (server-side validation) ─────────────
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
  v_payment public.payments%rowtype;
  v_request_id uuid;
begin
  if not (select private.is_platform_operator()) then
    raise exception 'not_authorized';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'payment_not_pending';
  end if;

  select sr.id into v_request_id
  from public.subscription_requests sr
  where sr.payment_id = p_payment_id
  limit 1;

  if v_request_id is null then
    raise exception 'request_not_found';
  end if;

  return public.review_subscription_request(
    v_request_id,
    p_action,
    p_rejection_reason
  );
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
begin
  if not (select private.is_platform_operator()) then
    raise exception 'not_authorized';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
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

  if v_sub_id is null or v_pay_id is null then
    insert into public.subscriptions (firm_id, plan_type, status, start_date, end_date)
    values (v_req.firm_id, v_plan_type, 'pending', null, null)
    returning id into v_sub_id;

    insert into public.payments (
      firm_id, subscription_id, amount, payment_method, receipt_url, status
    )
    values (
      v_req.firm_id, v_sub_id, v_req.amount_yer, 'bank_transfer', v_req.receipt_url, 'pending'
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
      rejection_reason = null
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

-- ─── RLS ───────────────────────────────────────────────────────────────────────
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

drop policy if exists "subscriptions_select" on public.subscriptions;
create policy "subscriptions_select" on public.subscriptions
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_platform_operator())
  );

drop policy if exists "payments_select" on public.payments;
create policy "payments_select" on public.payments
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_platform_operator())
  );

-- Gate notifications for expired firms (messages/alerts)
drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select" on public.notifications
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    and (employee_id is null or employee_id = (select private.get_current_employee_id()))
    and (select private.is_firm_subscription_active())
  );

drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update" on public.notifications
  for update
  using (
    firm_id = (select private.get_current_firm_id())
    and (employee_id is null or employee_id = (select private.get_current_employee_id()))
    and (select private.is_firm_subscription_active())
  );

-- ─── Grants ────────────────────────────────────────────────────────────────────
revoke all on function public.map_plan_to_plan_type(text) from public;
revoke all on function public.saas_plan_duration_days(text) from public;
revoke all on function public.sync_firm_subscription_from_subscriptions(uuid) from public;
revoke all on function public.expire_stale_subscriptions() from public;
revoke all on function public.provision_saas_records_for_request() from public;
revoke all on function public.submit_subscription_request(text, numeric, text, text, text, uuid) from public;
revoke all on function public.review_payment(uuid, text, text) from public;

grant execute on function public.map_plan_to_plan_type(text) to authenticated, service_role;
grant execute on function public.saas_plan_duration_days(text) to authenticated, service_role;
grant execute on function public.submit_subscription_request(text, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.review_payment(uuid, text, text) to authenticated;
grant execute on function public.review_subscription_request(uuid, text, text) to authenticated;
grant execute on function public.expire_stale_subscriptions() to service_role;
grant execute on function public.expire_stale_firm_subscriptions() to service_role;

revoke all on table public.subscriptions from public;
revoke all on table public.payments from public;
grant select on table public.subscriptions to authenticated;
grant select on table public.payments to authenticated;

comment on table public.subscriptions is 'SaaS subscription periods per firm (monthly/quarterly/yearly).';
comment on table public.payments is 'Bank-transfer payments linked to subscriptions; approved via platform operator RPC.';
