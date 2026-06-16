-- Subscription approval pipeline + protect subscription columns from client tampering
-- Run after 028_execution_requests_and_firm_settings.sql

-- ─── Platform operators (LegalMind staff who approve bank transfers) ───────────
create table if not exists private.platform_operators (
  auth_uid uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on private.platform_operators from public;
grant select on private.platform_operators to postgres, service_role;

create or replace function private.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select exists (
    select 1 from private.platform_operators po
    where po.auth_uid = auth.uid()
  );
$$;

revoke all on function private.is_platform_operator() from public;
grant execute on function private.is_platform_operator() to authenticated, service_role;

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_platform_operator();
$$;

revoke all on function public.is_platform_operator() from public;
grant execute on function public.is_platform_operator() to authenticated;

-- ─── Block firm managers from self-unlocking subscription fields ─────────────
create or replace function private.guard_firm_subscription_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.subscription_bypass', true) = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.subscription_status is distinct from old.subscription_status
       or new.subscription_plan is distinct from old.subscription_plan
       or new.subscription_expires_at is distinct from old.subscription_expires_at
       or new.is_locked is distinct from old.is_locked then
      raise exception 'subscription_fields_protected'
        using hint = 'Subscription changes require platform approval.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_firm_subscription_columns on public.firms;
create trigger trg_guard_firm_subscription_columns
  before update on public.firms
  for each row execute function private.guard_firm_subscription_columns();

-- ─── Batch-expire stale subscriptions (run via pg_cron or SQL editor daily) ────
create or replace function public.expire_stale_firm_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform set_config('app.subscription_bypass', 'on', true);

  update public.firms
  set subscription_status = 'expired',
      is_locked = true
  where subscription_expires_at is not null
    and subscription_expires_at <= now()
    and subscription_status in ('trial', 'active')
    and not is_locked;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_firm_subscriptions() from public;
grant execute on function public.expire_stale_firm_subscriptions() to service_role;

-- ─── Admin: review subscription payment request ──────────────────────────────
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

  if p_action = 'reject' then
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

    return jsonb_build_object('ok', true, 'action', 'rejected');
  end if;

  v_days := public.subscription_plan_duration_days(v_req.plan);

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
    'plan', v_req.plan
  );
end;
$$;

revoke all on function public.review_subscription_request(uuid, text, text) from public;
grant execute on function public.review_subscription_request(uuid, text, text) to authenticated;

-- ─── RLS: platform operators see all pending requests ────────────────────────
drop policy if exists "subscription_requests_select_platform" on public.subscription_requests;
create policy "subscription_requests_select_platform" on public.subscription_requests for select
  using ((select private.is_platform_operator()));

-- ─── Storage: platform operators can view receipts ───────────────────────────
drop policy if exists "subscription_receipts_select_platform" on storage.objects;
create policy "subscription_receipts_select_platform" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'subscription-receipts'
    and (select private.is_platform_operator())
  );

-- ─── Setup hint ──────────────────────────────────────────────────────────────
comment on table private.platform_operators is
  'LegalMind platform staff who approve subscription bank transfers. '
  'Add row: insert into private.platform_operators (auth_uid) values (''<auth.users.id>'');';
