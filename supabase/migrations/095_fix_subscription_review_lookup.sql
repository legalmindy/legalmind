-- Fix subscription approve/reject when payment_id is missing or mismatched on pending requests.

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
set search_path = public
as $$
begin
  if not (select private.is_billing_admin()) then
    raise exception 'not_authorized';
  end if;

  return query
  select
    sr.id as request_id,
    sr.id as payment_id,
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

revoke all on function public.review_payment(uuid, text, text) from public;
grant execute on function public.review_payment(uuid, text, text) to authenticated;

revoke all on function public.list_pending_subscription_requests_admin() from public;
grant execute on function public.list_pending_subscription_requests_admin() to authenticated;
