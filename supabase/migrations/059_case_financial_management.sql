-- Module 1: Case financial management — contract fields, payment ledger, receipts storage

-- ─── Extend cases with contract metadata ───────────────────────────────────────
alter table public.cases
  add column if not exists contract_currency text not null default 'YER',
  add column if not exists contract_date date;

comment on column public.cases.contract_currency is 'Contract currency code (default YER)';
comment on column public.cases.contract_date is 'Date the fee agreement was signed';

-- ─── Case payments ledger ─────────────────────────────────────────────────────
create table if not exists public.case_payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null default 'نقداً'
    check (payment_method in ('نقداً', 'تحويل بنكي', 'شيك', 'محفظة إلكترونية', 'أخرى')),
  notes text,
  receipt_storage_path text,
  receipt_file_name text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_case_payments_firm_case
  on public.case_payments (firm_id, case_id, payment_date desc)
  where deleted_at is null;

create index if not exists idx_case_payments_case_date
  on public.case_payments (case_id, payment_date desc)
  where deleted_at is null;

-- Backfill: one synthetic payment row for existing paid_amount > 0 (preserve totals)
insert into public.case_payments (firm_id, case_id, amount, payment_date, payment_method, notes)
select
  c.firm_id,
  c.id,
  c.paid_amount,
  coalesce(c.contract_date, c.created_at::date, current_date),
  'نقداً',
  'رصيد محمّل من النظام السابق'
from public.cases c
where c.deleted_at is null
  and coalesce(c.paid_amount, 0) > 0
  and not exists (
    select 1 from public.case_payments cp
    where cp.case_id = c.id and cp.deleted_at is null
  );

-- ─── Sync cases.paid_amount from ledger ────────────────────────────────────────
create or replace function public.sync_case_paid_amount_from_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id uuid;
  v_total numeric(12,2);
begin
  v_case_id := coalesce(new.case_id, old.case_id);

  select coalesce(sum(amount), 0)
  into v_total
  from public.case_payments
  where case_id = v_case_id
    and deleted_at is null;

  update public.cases
  set paid_amount = v_total,
      updated_at = now()
  where id = v_case_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_case_paid_on_payment on public.case_payments;
create trigger trg_sync_case_paid_on_payment
  after insert or update or delete on public.case_payments
  for each row execute function public.sync_case_paid_amount_from_payments();

-- ─── Storage bucket for payment receipts ───────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-payment-receipts',
  'case-payment-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── Permission helper (must exist before financial RLS helpers) ───────────────
create or replace function private.has_permission(perm_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = private, public
as $$
declare
  v_role text;
begin
  if perm_key is null or perm_key = '' then
    return false;
  end if;

  if to_regclass('public.firm_roles') is not null then
    return coalesce((
      select (fr.permissions ->> perm_key)::boolean
      from public.employees e
      join public.firm_roles fr on fr.id = e.firm_role_id
      where e.auth_uid = auth.uid()
        and e.deleted_at is null
        and e.status = 'active'
      limit 1
    ), false);
  end if;

  v_role := private.get_current_role()::text;

  return case perm_key
    when 'cases.view' then v_role in ('super_admin','admin','firm_manager','lawyer','assistant')
    when 'cases.create' then v_role in ('super_admin','admin','firm_manager','lawyer')
    when 'cases.edit' then v_role in ('super_admin','admin','firm_manager','lawyer')
    when 'cases.delete' then v_role in ('super_admin','admin','firm_manager')
    when 'financials.view' then v_role in ('super_admin','admin','firm_manager','lawyer','assistant')
    when 'financials.add_payments' then v_role in ('super_admin','admin','firm_manager')
    when 'financials.print_receipts' then v_role in ('super_admin','admin','firm_manager','assistant')
    when 'sessions.view' then v_role in ('super_admin','admin','firm_manager','lawyer','assistant')
    when 'sessions.create' then v_role in ('super_admin','admin','firm_manager','lawyer')
    when 'sessions.edit' then v_role in ('super_admin','admin','firm_manager','lawyer')
    else private.is_office_admin()
  end;
end;
$$;

-- ─── Permission helpers for financial actions ──────────────────────────────────
create or replace function private.can_view_case_financials(target_case_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select
    private.is_firm_subscription_active()
    and (
      private.is_office_admin()
      or private.get_current_role() = 'assistant'
      or private.has_permission('financials.view'::text)
      or (
        target_case_id is not null
        and private.can_access_case(target_case_id)
        and (
          private.has_permission('financials.view'::text)
          or private.get_current_role() in ('lawyer', 'firm_manager', 'admin', 'super_admin')
        )
      )
    );
$$;

create or replace function private.can_manage_case_financials(target_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select
    private.is_firm_subscription_active()
    and private.can_access_case(target_case_id)
    and (
      private.is_office_admin()
      or private.has_permission('financials.add_payments'::text)
    );
$$;

-- ─── RLS: case_payments ───────────────────────────────────────────────────────
alter table public.case_payments enable row level security;

drop policy if exists "case_payments_select" on public.case_payments;
create policy "case_payments_select" on public.case_payments
  for select using (
    firm_id = private.get_current_firm_id()
    and deleted_at is null
    and private.can_access_case(case_id)
    and private.can_view_case_financials(case_id)
  );

drop policy if exists "case_payments_insert" on public.case_payments;
create policy "case_payments_insert" on public.case_payments
  for insert with check (
    firm_id = private.get_current_firm_id()
    and private.can_manage_case_financials(case_id)
  );

drop policy if exists "case_payments_update" on public.case_payments;
create policy "case_payments_update" on public.case_payments
  for update using (
    firm_id = private.get_current_firm_id()
    and deleted_at is null
    and private.can_manage_case_financials(case_id)
  );

drop policy if exists "case_payments_delete" on public.case_payments;
create policy "case_payments_delete" on public.case_payments
  for delete using (
    firm_id = private.get_current_firm_id()
    and private.can_manage_case_financials(case_id)
  );

-- ─── Storage RLS: case-payment-receipts ────────────────────────────────────────
drop policy if exists "case_payment_receipts_select" on storage.objects;
create policy "case_payment_receipts_select" on storage.objects
  for select using (
    bucket_id = 'case-payment-receipts'
    and private.is_firm_subscription_active()
    and private.can_access_case(private.storage_case_id(name))
    and private.can_view_case_financials(private.storage_case_id(name))
  );

drop policy if exists "case_payment_receipts_insert" on storage.objects;
create policy "case_payment_receipts_insert" on storage.objects
  for insert with check (
    bucket_id = 'case-payment-receipts'
    and private.is_firm_subscription_active()
    and private.can_manage_case_financials(private.storage_case_id(name))
  );

drop policy if exists "case_payment_receipts_delete" on storage.objects;
create policy "case_payment_receipts_delete" on storage.objects
  for delete using (
    bucket_id = 'case-payment-receipts'
    and private.can_manage_case_financials(private.storage_case_id(name))
  );

-- ─── RPC: add case payment ─────────────────────────────────────────────────────
create or replace function public.add_case_payment(
  p_case_id uuid,
  p_amount numeric,
  p_payment_date date default current_date,
  p_payment_method text default 'نقداً',
  p_notes text default null,
  p_receipt_storage_path text default null,
  p_receipt_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
  v_payment public.case_payments%rowtype;
begin
  if not private.can_manage_case_financials(p_case_id) then
    raise exception 'not_authorized';
  end if;

  v_firm_id := private.get_current_firm_id();

  insert into public.case_payments (
    firm_id, case_id, amount, payment_date, payment_method, notes,
    receipt_storage_path, receipt_file_name, created_by
  )
  values (
    v_firm_id, p_case_id, p_amount, p_payment_date, p_payment_method, p_notes,
    p_receipt_storage_path, p_receipt_file_name, private.get_current_employee_id()
  )
  returning * into v_payment;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment.id,
    'amount', v_payment.amount
  );
end;
$$;

revoke all on function public.add_case_payment(uuid, numeric, date, text, text, text, text) from public;
grant execute on function public.add_case_payment(uuid, numeric, date, text, text, text, text) to authenticated;

grant select, insert, update, delete on public.case_payments to authenticated;
