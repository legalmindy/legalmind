-- 101: Fix subscription approve/reject "request_not_found" (400)
--
-- Root cause:
--   Migration 083 (step 2) downgraded review_subscription_request and
--   review_payment to SECURITY INVOKER. list_pending_subscription_requests_admin
--   still runs as DEFINER and shows pending rows, but review runs as the caller
--   under RLS with no UPDATE policies on subscription_requests / payments /
--   subscriptions — the lookup/update fails → request_not_found (400).
--
-- Fix:
--   • Restore SECURITY DEFINER on billing review RPCs + row_security off
--   • Resilient request lookup (by request id OR linked payment id)
--   • Billing-admin UPDATE policies (defence in depth if any RPC is INVOKER)

-- ─── 1) review_subscription_request (DEFINER) ────────────────────────────────
create or replace function public.review_subscription_request(
  p_request_id uuid,
  p_action text,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_req public.subscription_requests%rowtype;
  v_days integer;
  v_base timestamptz;
  v_new_expires timestamptz;
  v_plan_type text;
  v_firm_plan text;
  v_sub_id uuid;
  v_pay_id uuid;
  v_proof_url text;
begin
  perform set_config('row_security', 'off', true);

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
     or payment_id = p_request_id
  order by case when id = p_request_id then 0 else 1 end, created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  v_plan_type := public.map_plan_to_plan_type(v_req.plan);
  v_firm_plan := public.map_plan_to_firm_subscription_plan(v_req.plan);
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
    where id = v_req.id;
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
    where id = v_req.id;

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
      plan_type = v_plan_type,
      start_date = coalesce(start_date, v_base),
      end_date = v_new_expires,
      updated_at = now()
  where id = v_sub_id;

  update public.subscription_requests
  set status = 'approved',
      admin_notes = nullif(trim(p_admin_notes), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = v_req.id;

  perform set_config('app.subscription_bypass', 'on', true);

  update public.firms
  set subscription_status = 'active',
      subscription_plan = v_firm_plan,
      subscription_expires_at = v_new_expires,
      is_locked = false,
      plan = case v_firm_plan when 'annual' then 'enterprise' else 'pro' end,
      updated_at = now()
  where id = v_req.firm_id;

  insert into public.notifications (firm_id, employee_id, title, message, type)
  values (
    v_req.firm_id,
    null,
    'تم تفعيل الاشتراك',
    format(
      'تمت الموافقة على دفعتك وتفعيل باقة %s حتى %s.',
      v_firm_plan,
      to_char(v_new_expires, 'YYYY-MM-DD')
    ),
    'system'
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'approved',
    'payment_id', v_pay_id,
    'subscription_id', v_sub_id,
    'expires_at', v_new_expires,
    'plan', v_firm_plan
  );
end;
$$;

-- ─── 2) review_payment (DEFINER, resilient lookup) ───────────────────────────
create or replace function public.review_payment(
  p_payment_id uuid,
  p_action text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_request_id uuid;
begin
  perform set_config('row_security', 'off', true);

  if not (select private.is_billing_admin()) then
    raise exception 'not_authorized';
  end if;

  select sr.id into v_request_id
  from public.subscription_requests sr
  left join public.payments p on p.id = sr.payment_id
  where sr.id = p_payment_id
     or sr.payment_id = p_payment_id
     or p.id = p_payment_id
  order by sr.created_at desc
  limit 1;

  if v_request_id is null then
    raise exception 'request_not_found';
  end if;

  return public.review_subscription_request(v_request_id, p_action, p_rejection_reason);
end;
$$;

-- ─── 3) list_pending_subscription_requests_admin (DEFINER) ───────────────────
create or replace function public.list_pending_subscription_requests_admin()
returns table (
  request_id uuid,
  payment_id uuid,
  subscription_id uuid,
  firm_id uuid,
  firm_name text,
  plan text,
  plan_type text,
  amount_yer numeric,
  transfer_reference text,
  receipt_path text,
  receipt_url text,
  proof_of_payment_url text,
  payment_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  perform set_config('row_security', 'off', true);

  if not (select private.is_billing_admin()) then
    raise exception 'not_authorized';
  end if;

  return query
  select
    sr.id as request_id,
    coalesce(sr.payment_id, sr.id) as payment_id,
    sr.subscription_id,
    sr.firm_id,
    f.name as firm_name,
    sr.plan,
    coalesce(
      (select s.plan_type from public.subscriptions s where s.id = sr.subscription_id limit 1),
      case sr.plan
        when 'monthly' then 'monthly'
        when 'quarterly' then 'quarterly'
        when 'annual' then 'yearly'
        when 'yearly' then 'yearly'
        else sr.plan
      end
    ) as plan_type,
    sr.amount_yer,
    sr.transfer_reference,
    sr.receipt_path,
    sr.receipt_url,
    coalesce(
      (select coalesce(p.proof_of_payment_url, p.receipt_url)
       from public.payments p where p.id = sr.payment_id limit 1),
      sr.receipt_url
    ) as proof_of_payment_url,
    coalesce(
      (select p.status from public.payments p where p.id = sr.payment_id limit 1),
      'pending'
    ) as payment_status,
    sr.created_at
  from public.subscription_requests sr
  inner join public.firms f on f.id = sr.firm_id
  where sr.status = 'pending'
  order by sr.created_at asc;
end;
$$;

-- ─── 4) Billing-admin UPDATE policies (defence in depth) ─────────────────────
drop policy if exists subscription_requests_update_billing_admin on public.subscription_requests;
create policy subscription_requests_update_billing_admin on public.subscription_requests
  for update
  to authenticated
  using ((select private.is_billing_admin()))
  with check ((select private.is_billing_admin()));

drop policy if exists payments_update_billing_admin on public.payments;
create policy payments_update_billing_admin on public.payments
  for update
  to authenticated
  using ((select private.is_billing_admin()))
  with check ((select private.is_billing_admin()));

drop policy if exists subscriptions_update_billing_admin on public.subscriptions;
create policy subscriptions_update_billing_admin on public.subscriptions
  for update
  to authenticated
  using ((select private.is_billing_admin()))
  with check ((select private.is_billing_admin()));

-- ─── 5) Grants ───────────────────────────────────────────────────────────────
revoke all on function public.review_subscription_request(uuid, text, text) from public, anon;
grant execute on function public.review_subscription_request(uuid, text, text) to authenticated;

revoke all on function public.review_payment(uuid, text, text) from public, anon;
grant execute on function public.review_payment(uuid, text, text) to authenticated;

revoke all on function public.list_pending_subscription_requests_admin() from public, anon;
grant execute on function public.list_pending_subscription_requests_admin() to authenticated;

notify pgrst, 'reload schema';
