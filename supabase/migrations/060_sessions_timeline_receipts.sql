-- Modules 2–4: Receipt vouchers, session enhancements, case timeline

-- ─── Module 3: Session enhancements ───────────────────────────────────────────
alter table public.sessions
  add column if not exists judge_name text,
  add column if not exists next_session_date date,
  add column if not exists session_outcome text;

comment on column public.sessions.session_outcome is 'Rich text: events, decisions, outcomes, lawyer notes';

-- ─── Module 4: Unified case timeline ───────────────────────────────────────────
create table if not exists public.case_timeline_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  event_type text not null check (event_type in (
    'case_created', 'case_updated', 'status_changed', 'document_uploaded',
    'payment_received', 'receipt_printed', 'session_added', 'session_updated',
    'note_added', 'lawyer_assigned', 'permission_changed', 'system'
  )),
  title text not null,
  details text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_timeline_case_created
  on public.case_timeline_events (case_id, created_at desc);

create index if not exists idx_case_timeline_firm_created
  on public.case_timeline_events (firm_id, created_at desc);

-- Helper to append timeline events
create or replace function public.append_case_timeline_event(
  p_case_id uuid,
  p_event_type text,
  p_title text,
  p_details text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
  v_id uuid;
begin
  select firm_id into v_firm_id
  from public.cases
  where id = p_case_id and deleted_at is null;

  if v_firm_id is null then
    raise exception 'case_not_found';
  end if;

  insert into public.case_timeline_events (
    firm_id, case_id, event_type, title, details, metadata, actor_id
  )
  values (
    v_firm_id, p_case_id, p_event_type, p_title, p_details, p_metadata,
    private.get_current_employee_id()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Timeline on payments
create or replace function private.timeline_on_case_payment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' and new.deleted_at is null then
    perform public.append_case_timeline_event(
      new.case_id,
      'payment_received',
      format('دفعة بقيمة %s ر.ي', new.amount),
      coalesce(new.notes, ''),
      jsonb_build_object('payment_id', new.id, 'amount', new.amount, 'payment_date', new.payment_date)
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_timeline_case_payment on public.case_payments;
create trigger trg_timeline_case_payment
  after insert on public.case_payments
  for each row execute function private.timeline_on_case_payment();

-- Timeline on sessions
create or replace function private.timeline_on_session()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    perform public.append_case_timeline_event(
      new.case_id,
      'session_added',
      format('جلسة %s — %s', coalesce(new.session_type, ''), coalesce(new.court, '')),
      coalesce(new.notes, ''),
      jsonb_build_object('session_id', new.id, 'session_date', new.session_date)
    );
  elsif tg_op = 'UPDATE' and new.deleted_at is null then
    perform public.append_case_timeline_event(
      new.case_id,
      'session_updated',
      format('تحديث جلسة — %s', coalesce(new.status, '')),
      coalesce(new.session_outcome, new.notes, ''),
      jsonb_build_object('session_id', new.id)
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_timeline_session on public.sessions;
create trigger trg_timeline_session
  after insert or update on public.sessions
  for each row execute function private.timeline_on_session();

-- ─── Module 2: Receipt vouchers ────────────────────────────────────────────────
create sequence if not exists public.receipt_voucher_number_seq;

create table if not exists public.receipt_vouchers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete restrict,
  case_payment_id uuid not null references public.case_payments(id) on delete restrict,
  receipt_number text not null,
  amount numeric(12,2) not null,
  client_name text,
  case_number text,
  contract_total numeric(12,2),
  remaining_balance numeric(12,2),
  payment_method text,
  notes text,
  qr_payload text,
  printed_at timestamptz not null default now(),
  printed_by uuid references public.employees(id) on delete set null,
  reprint_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (firm_id, receipt_number)
);

create index if not exists idx_receipt_vouchers_case
  on public.receipt_vouchers (case_id, printed_at desc);

create or replace function public.next_receipt_number(p_firm_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_seq bigint;
begin
  select coalesce(max(
    nullif(regexp_replace(receipt_number, '^RV-' || v_year || '-', ''), '')::bigint
  ), 0) + 1
  into v_seq
  from public.receipt_vouchers
  where firm_id = p_firm_id
    and receipt_number like 'RV-' || v_year || '-%';

  return format('RV-%s-%s', v_year, lpad(v_seq::text, 5, '0'));
end;
$$;

create or replace function public.create_receipt_voucher(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_pay public.case_payments%rowtype;
  v_case public.cases%rowtype;
  v_client_name text;
  v_receipt_number text;
  v_voucher_id uuid;
  v_remaining numeric(12,2);
  v_qr text;
begin
  select * into v_pay
  from public.case_payments
  where id = p_payment_id and deleted_at is null;

  if not found then raise exception 'payment_not_found'; end if;
  if not private.can_view_case_financials(v_pay.case_id) then raise exception 'not_authorized'; end if;
  if not private.has_permission('financials.print_receipts') and not private.is_office_admin() then
    raise exception 'not_authorized';
  end if;

  select * into v_case from public.cases where id = v_pay.case_id;
  select name into v_client_name from public.clients where id = v_case.client_id;

  v_receipt_number := public.next_receipt_number(v_pay.firm_id);
  v_remaining := greatest(coalesce(v_case.total_amount, 0) - coalesce(v_case.paid_amount, 0), 0);
  v_qr := jsonb_build_object(
    'receipt', v_receipt_number,
    'case', v_case.court_case_number,
    'amount', v_pay.amount,
    'firm', v_pay.firm_id
  )::text;

  insert into public.receipt_vouchers (
    firm_id, case_id, case_payment_id, receipt_number, amount,
    client_name, case_number, contract_total, remaining_balance,
    payment_method, notes, qr_payload, printed_by
  )
  values (
    v_pay.firm_id, v_pay.case_id, v_pay.id, v_receipt_number, v_pay.amount,
    v_client_name, v_case.court_case_number, v_case.total_amount, v_remaining,
    v_pay.payment_method, v_pay.notes, v_qr, private.get_current_employee_id()
  )
  returning id into v_voucher_id;

  perform public.append_case_timeline_event(
    v_pay.case_id,
    'receipt_printed',
    format('سند قبض %s', v_receipt_number),
    format('مبلغ %s ر.ي', v_pay.amount),
    jsonb_build_object('voucher_id', v_voucher_id, 'receipt_number', v_receipt_number)
  );

  return jsonb_build_object(
    'ok', true,
    'voucher_id', v_voucher_id,
    'receipt_number', v_receipt_number,
    'qr_payload', v_qr
  );
end;
$$;

create or replace function public.reprint_receipt_voucher(p_voucher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_v public.receipt_vouchers%rowtype;
begin
  select * into v_v from public.receipt_vouchers where id = p_voucher_id;
  if not found then raise exception 'voucher_not_found'; end if;
  if not private.can_view_case_financials(v_v.case_id) then raise exception 'not_authorized'; end if;

  update public.receipt_vouchers
  set reprint_count = reprint_count + 1,
      printed_at = now(),
      printed_by = private.get_current_employee_id()
  where id = p_voucher_id;

  return jsonb_build_object('ok', true, 'receipt_number', v_v.receipt_number);
end;
$$;

-- RLS: timeline + vouchers
alter table public.case_timeline_events enable row level security;
alter table public.receipt_vouchers enable row level security;

drop policy if exists "case_timeline_select" on public.case_timeline_events;
create policy "case_timeline_select" on public.case_timeline_events
  for select using (
    firm_id = private.get_current_firm_id()
    and private.can_access_case(case_id)
  );

drop policy if exists "receipt_vouchers_select" on public.receipt_vouchers;
create policy "receipt_vouchers_select" on public.receipt_vouchers
  for select using (
    firm_id = private.get_current_firm_id()
    and private.can_view_case_financials(case_id)
  );

drop policy if exists "receipt_vouchers_insert" on public.receipt_vouchers;
create policy "receipt_vouchers_insert" on public.receipt_vouchers
  for insert with check (
    firm_id = private.get_current_firm_id()
    and private.can_view_case_financials(case_id)
  );

revoke all on function public.append_case_timeline_event(uuid, text, text, text, jsonb) from public;
grant execute on function public.append_case_timeline_event(uuid, text, text, text, jsonb) to authenticated;
revoke all on function public.create_receipt_voucher(uuid) from public;
grant execute on function public.create_receipt_voucher(uuid) to authenticated;
revoke all on function public.reprint_receipt_voucher(uuid) from public;
grant execute on function public.reprint_receipt_voucher(uuid) to authenticated;

grant select on public.case_timeline_events to authenticated;
grant select, insert on public.receipt_vouchers to authenticated;
