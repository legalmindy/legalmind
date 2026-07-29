-- Module: Per-case litigation expenses (case_expenses)
-- Safe additive migration — does not alter existing payment/fee behavior.

-- ─── Optional expense budget on cases ─────────────────────────────────────────
alter table public.cases
  add column if not exists expense_budget numeric(12,2)
  check (expense_budget is null or expense_budget >= 0);

comment on column public.cases.expense_budget is
  'Optional litigation-expense budget for the case; used for over-budget alerts';

-- ─── Expense type catalog (per firm) ──────────────────────────────────────────
create table if not exists public.case_expense_types (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 2),
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (firm_id, name)
);

create index if not exists idx_case_expense_types_firm
  on public.case_expense_types (firm_id, sort_order, name);

create or replace function public.seed_case_expense_types(p_firm_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_firm_id is null then
    return;
  end if;

  insert into public.case_expense_types (firm_id, name, is_system, sort_order)
  values
    (p_firm_id, 'رسوم رفع الدعوى', true, 10),
    (p_firm_id, 'رسوم المحكمة', true, 20),
    (p_firm_id, 'رسوم فتح الملف', true, 30),
    (p_firm_id, 'رسوم تحصيل الملف', true, 40),
    (p_firm_id, 'رسوم التنفيذ', true, 50),
    (p_firm_id, 'رسوم الاستئناف', true, 60),
    (p_firm_id, 'رسوم الطعن', true, 70),
    (p_firm_id, 'رسوم الإعلان', true, 80),
    (p_firm_id, 'رسوم الخبير', true, 90),
    (p_firm_id, 'رسوم الترجمة', true, 100),
    (p_firm_id, 'رسوم التوثيق', true, 110),
    (p_firm_id, 'رسوم استخراج المستندات', true, 120),
    (p_firm_id, 'رسوم البريد', true, 130),
    (p_firm_id, 'رسوم التصديق', true, 140),
    (p_firm_id, 'رسوم تصوير ونسخ', true, 150),
    (p_firm_id, 'رسوم الانتقال والسفر', true, 160),
    (p_firm_id, 'أتعاب المندوب', true, 170),
    (p_firm_id, 'أتعاب التنفيذ', true, 180),
    (p_firm_id, 'مصروفات أخرى', true, 190)
  on conflict (firm_id, name) do nothing;
end;
$$;

revoke all on function public.seed_case_expense_types(uuid) from public;
grant execute on function public.seed_case_expense_types(uuid) to authenticated, service_role;

do $$
declare r record;
begin
  for r in select id from public.firms where deleted_at is null loop
    perform public.seed_case_expense_types(r.id);
  end loop;
end $$;

create or replace function private.trg_firms_seed_case_expense_types()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform public.seed_case_expense_types(new.id);
  return new;
end;
$$;

drop trigger if exists trg_firms_seed_case_expense_types on public.firms;
create trigger trg_firms_seed_case_expense_types
  after insert on public.firms
  for each row execute function private.trg_firms_seed_case_expense_types();

-- ─── Case expenses ledger ─────────────────────────────────────────────────────
create table if not exists public.case_expenses (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete restrict,
  expense_type text not null check (char_length(trim(expense_type)) >= 2),
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default current_date,
  payment_status text not null default 'غير مدفوع'
    check (payment_status in ('مدفوع', 'غير مدفوع')),
  paid_by text not null default 'الموكل'
    check (paid_by in ('الموكل', 'المحامي', 'الطرف الآخر')),
  court_name text,
  receipt_number text,
  notes text,
  due_date date,
  attachment_path text,
  attachment_file_name text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_case_expenses_firm_case
  on public.case_expenses (firm_id, case_id, expense_date desc)
  where deleted_at is null;

create index if not exists idx_case_expenses_status
  on public.case_expenses (firm_id, payment_status, due_date)
  where deleted_at is null;

create index if not exists idx_case_expenses_type
  on public.case_expenses (firm_id, expense_type)
  where deleted_at is null;

create or replace function private.touch_case_expenses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_case_expenses_updated_at on public.case_expenses;
create trigger trg_case_expenses_updated_at
  before update on public.case_expenses
  for each row execute function private.touch_case_expenses_updated_at();

drop trigger if exists audit_case_expenses on public.case_expenses;
create trigger audit_case_expenses
  after insert or update or delete on public.case_expenses
  for each row execute function private.insert_audit_log();

-- ─── Storage bucket ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-expense-receipts',
  'case-expense-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── RLS: expense types ───────────────────────────────────────────────────────
alter table public.case_expense_types enable row level security;

drop policy if exists "case_expense_types_select" on public.case_expense_types;
create policy "case_expense_types_select" on public.case_expense_types
  for select to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_firm_subscription_active())
  );

drop policy if exists "case_expense_types_insert" on public.case_expense_types;
create policy "case_expense_types_insert" on public.case_expense_types
  for insert to authenticated
  with check (
    firm_id = (select private.get_current_firm_id())
    and (
      (select private.is_office_admin())
      or (select private.has_permission('financials.add_payments'))
    )
  );

drop policy if exists "case_expense_types_update" on public.case_expense_types;
create policy "case_expense_types_update" on public.case_expense_types
  for update to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and is_system = false
    and (
      (select private.is_office_admin())
      or (select private.has_permission('financials.add_payments'))
    )
  );

grant select, insert, update on public.case_expense_types to authenticated;

-- ─── RLS: case_expenses ───────────────────────────────────────────────────────
alter table public.case_expenses enable row level security;

drop policy if exists "case_expenses_select" on public.case_expenses;
create policy "case_expenses_select" on public.case_expenses
  for select to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (select private.can_access_case(case_id))
    and (select private.can_view_case_financials(case_id))
  );

drop policy if exists "case_expenses_insert" on public.case_expenses;
create policy "case_expenses_insert" on public.case_expenses
  for insert to authenticated
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select private.can_manage_case_financials(case_id))
  );

drop policy if exists "case_expenses_update" on public.case_expenses;
create policy "case_expenses_update" on public.case_expenses
  for update to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (select private.can_manage_case_financials(case_id))
  );

grant select, insert, update on public.case_expenses to authenticated;

-- ─── Storage RLS (scoped to authenticated) ────────────────────────────────────
drop policy if exists "case_expense_receipts_select" on storage.objects;
create policy "case_expense_receipts_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'case-expense-receipts'
    and (select private.is_firm_subscription_active())
    and (select private.can_access_case(private.storage_case_id(name)))
    and (select private.can_view_case_financials(private.storage_case_id(name)))
  );

drop policy if exists "case_expense_receipts_insert" on storage.objects;
create policy "case_expense_receipts_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'case-expense-receipts'
    and (select private.is_firm_subscription_active())
    and (select private.can_manage_case_financials(private.storage_case_id(name)))
  );

drop policy if exists "case_expense_receipts_update" on storage.objects;
create policy "case_expense_receipts_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'case-expense-receipts'
    and (select private.can_manage_case_financials(private.storage_case_id(name)))
  );

drop policy if exists "case_expense_receipts_delete" on storage.objects;
create policy "case_expense_receipts_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'case-expense-receipts'
    and (select private.can_manage_case_financials(private.storage_case_id(name)))
  );

-- ─── RPCs ─────────────────────────────────────────────────────────────────────
create or replace function public.add_case_expense(
  p_case_id uuid,
  p_expense_type text,
  p_amount numeric,
  p_expense_date date default current_date,
  p_payment_status text default 'غير مدفوع',
  p_paid_by text default 'الموكل',
  p_court_name text default null,
  p_receipt_number text default null,
  p_notes text default null,
  p_due_date date default null,
  p_attachment_path text default null,
  p_attachment_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm uuid := private.get_current_firm_id();
  v_row public.case_expenses%rowtype;
begin
  if not private.can_manage_case_financials(p_case_id) then
    raise exception 'not_authorized';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  if p_payment_status not in ('مدفوع', 'غير مدفوع') then
    raise exception 'invalid_payment_status';
  end if;
  if p_paid_by not in ('الموكل', 'المحامي', 'الطرف الآخر') then
    raise exception 'invalid_paid_by';
  end if;

  insert into public.case_expenses (
    firm_id, case_id, expense_type, amount, expense_date, payment_status, paid_by,
    court_name, receipt_number, notes, due_date, attachment_path, attachment_file_name, created_by
  ) values (
    v_firm, p_case_id, trim(p_expense_type), p_amount, coalesce(p_expense_date, current_date),
    p_payment_status, p_paid_by, nullif(trim(p_court_name), ''), nullif(trim(p_receipt_number), ''),
    nullif(trim(p_notes), ''), p_due_date, p_attachment_path, p_attachment_file_name,
    private.get_current_employee_id()
  )
  returning * into v_row;

  return jsonb_build_object('ok', true, 'expense_id', v_row.id);
end;
$$;

create or replace function public.update_case_expense(
  p_expense_id uuid,
  p_expense_type text default null,
  p_amount numeric default null,
  p_expense_date date default null,
  p_payment_status text default null,
  p_paid_by text default null,
  p_court_name text default null,
  p_receipt_number text default null,
  p_notes text default null,
  p_due_date date default null,
  p_attachment_path text default null,
  p_attachment_file_name text default null,
  p_clear_due_date boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_case uuid;
  v_firm uuid := private.get_current_firm_id();
begin
  select case_id into v_case
  from public.case_expenses
  where id = p_expense_id and firm_id = v_firm and deleted_at is null;

  if v_case is null then
    raise exception 'not_found';
  end if;
  if not private.can_manage_case_financials(v_case) then
    raise exception 'not_authorized';
  end if;
  if p_payment_status is not null and p_payment_status not in ('مدفوع', 'غير مدفوع') then
    raise exception 'invalid_payment_status';
  end if;
  if p_paid_by is not null and p_paid_by not in ('الموكل', 'المحامي', 'الطرف الآخر') then
    raise exception 'invalid_paid_by';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  update public.case_expenses set
    expense_type = coalesce(nullif(trim(p_expense_type), ''), expense_type),
    amount = coalesce(p_amount, amount),
    expense_date = coalesce(p_expense_date, expense_date),
    payment_status = coalesce(p_payment_status, payment_status),
    paid_by = coalesce(p_paid_by, paid_by),
    court_name = case when p_court_name is null then court_name else nullif(trim(p_court_name), '') end,
    receipt_number = case when p_receipt_number is null then receipt_number else nullif(trim(p_receipt_number), '') end,
    notes = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    due_date = case
      when p_clear_due_date then null
      when p_due_date is not null then p_due_date
      else due_date
    end,
    attachment_path = coalesce(p_attachment_path, attachment_path),
    attachment_file_name = coalesce(p_attachment_file_name, attachment_file_name),
    updated_at = now()
  where id = p_expense_id;

  return jsonb_build_object('ok', true, 'expense_id', p_expense_id);
end;
$$;

create or replace function public.soft_delete_case_expense(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_case uuid;
  v_firm uuid := private.get_current_firm_id();
begin
  select case_id into v_case
  from public.case_expenses
  where id = p_expense_id and firm_id = v_firm and deleted_at is null;

  if v_case is null then
    raise exception 'not_found';
  end if;
  if not private.can_manage_case_financials(v_case) then
    raise exception 'not_authorized';
  end if;

  update public.case_expenses
  set deleted_at = now(), updated_at = now()
  where id = p_expense_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_case_expense_type(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm uuid := private.get_current_firm_id();
  v_id uuid;
  v_name text := trim(p_name);
begin
  if not (private.is_office_admin() or private.has_permission('financials.add_payments')) then
    raise exception 'not_authorized';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'invalid_name';
  end if;

  insert into public.case_expense_types (firm_id, name, is_system, sort_order)
  values (v_firm, v_name, false, 500)
  on conflict (firm_id, name) do update set name = excluded.name
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name);
end;
$$;

-- Extended financial summary (keeps prior columns; adds expense metrics)
create or replace view public.v_case_financial_summary
with (security_invoker = true)
as
select
  c.firm_id,
  c.id as case_id,
  c.title,
  c.court_case_number,
  cl.name as client_name,
  c.contract_currency,
  c.contract_date,
  c.total_amount as contract_total,
  c.paid_amount as total_paid,
  c.remaining_amount,
  case when c.total_amount > 0
    then round((c.paid_amount / c.total_amount) * 100, 2)
    else 0
  end as payment_percentage,
  (
    select max(cp.payment_date)
    from public.case_payments cp
    where cp.case_id = c.id and cp.deleted_at is null
  ) as last_payment_date,
  (
    select cp.amount
    from public.case_payments cp
    where cp.case_id = c.id and cp.deleted_at is null
    order by cp.payment_date desc, cp.created_at desc
    limit 1
  ) as last_payment_amount,
  c.expense_budget,
  coalesce((
    select sum(ce.amount) from public.case_expenses ce
    where ce.case_id = c.id and ce.deleted_at is null
  ), 0) as total_expenses,
  coalesce((
    select sum(ce.amount) from public.case_expenses ce
    where ce.case_id = c.id and ce.deleted_at is null and ce.payment_status = 'مدفوع'
  ), 0) as total_expenses_paid,
  coalesce((
    select sum(ce.amount) from public.case_expenses ce
    where ce.case_id = c.id and ce.deleted_at is null and ce.payment_status = 'غير مدفوع'
  ), 0) as total_expenses_unpaid,
  coalesce((
    select count(*) from public.case_expenses ce
    where ce.case_id = c.id and ce.deleted_at is null
  ), 0)::integer as expenses_count,
  coalesce((
    select sum(ce.amount) from public.case_expenses ce
    where ce.case_id = c.id and ce.deleted_at is null and ce.paid_by = 'الموكل'
  ), 0) as expenses_paid_by_client,
  coalesce((
    select sum(ce.amount) from public.case_expenses ce
    where ce.case_id = c.id and ce.deleted_at is null and ce.paid_by = 'المحامي'
  ), 0) as expenses_paid_by_office,
  greatest(
    c.total_amount
      - coalesce((
          select sum(ce.amount) from public.case_expenses ce
          where ce.case_id = c.id and ce.deleted_at is null and ce.paid_by = 'المحامي'
        ), 0)
  , 0) as net_office_fees_after_expenses
from public.cases c
join public.clients cl on cl.id = c.client_id
where c.deleted_at is null;

grant select on public.v_case_financial_summary to authenticated;

-- Report RPC with filters
create or replace function public.get_case_expenses_report(
  p_from date default null,
  p_to date default null,
  p_court_name text default null,
  p_lawyer_id uuid default null,
  p_expense_type text default null,
  p_client_id uuid default null,
  p_case_id uuid default null,
  p_payment_status text default null
)
returns table (
  expense_id uuid,
  case_id uuid,
  case_title text,
  court_case_number text,
  client_id uuid,
  client_name text,
  lawyer_id uuid,
  lawyer_name text,
  expense_type text,
  amount numeric,
  expense_date date,
  payment_status text,
  paid_by text,
  court_name text,
  receipt_number text,
  notes text,
  due_date date,
  attachment_path text,
  attachment_file_name text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    ce.id,
    c.id,
    c.title,
    c.court_case_number,
    cl.id,
    cl.name,
    c.assigned_lawyer_id,
    e.full_name,
    ce.expense_type,
    ce.amount,
    ce.expense_date,
    ce.payment_status,
    ce.paid_by,
    ce.court_name,
    ce.receipt_number,
    ce.notes,
    ce.due_date,
    ce.attachment_path,
    ce.attachment_file_name
  from public.case_expenses ce
  join public.cases c on c.id = ce.case_id
  join public.clients cl on cl.id = c.client_id
  left join public.lawyers l on l.id = c.assigned_lawyer_id
  left join public.employees e on e.id = l.employee_id
  where ce.firm_id = private.get_current_firm_id()
    and ce.deleted_at is null
    and c.deleted_at is null
    and (private.is_office_admin() or private.has_permission('financials.view'))
    and private.can_access_case(ce.case_id)
    and (p_from is null or ce.expense_date >= p_from)
    and (p_to is null or ce.expense_date <= p_to)
    and (p_court_name is null or p_court_name = '' or coalesce(ce.court_name, c.court) ilike '%' || p_court_name || '%')
    and (p_lawyer_id is null or c.assigned_lawyer_id = p_lawyer_id)
    and (p_expense_type is null or p_expense_type = '' or ce.expense_type = p_expense_type)
    and (p_client_id is null or c.client_id = p_client_id)
    and (p_case_id is null or ce.case_id = p_case_id)
    and (p_payment_status is null or p_payment_status = '' or ce.payment_status = p_payment_status)
  order by ce.expense_date desc, ce.created_at desc;
$$;

-- Alerts helper for dashboard / case detail
create or replace function public.get_case_expense_alerts(p_due_within_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_firm uuid := private.get_current_firm_id();
  v_days integer := greatest(1, least(coalesce(p_due_within_days, 7), 60));
begin
  if not (private.is_office_admin() or private.has_permission('financials.view')) then
    raise exception 'not_authorized';
  end if;

  return jsonb_build_object(
    'unpaid_count', (
      select count(*) from public.case_expenses ce
      where ce.firm_id = v_firm and ce.deleted_at is null and ce.payment_status = 'غير مدفوع'
        and private.can_access_case(ce.case_id)
    ),
    'unpaid_amount', (
      select coalesce(sum(ce.amount), 0) from public.case_expenses ce
      where ce.firm_id = v_firm and ce.deleted_at is null and ce.payment_status = 'غير مدفوع'
        and private.can_access_case(ce.case_id)
    ),
    'due_soon', coalesce((
      select jsonb_agg(jsonb_build_object(
        'expense_id', x.id,
        'case_id', x.case_id,
        'case_title', x.title,
        'expense_type', x.expense_type,
        'amount', x.amount,
        'due_date', x.due_date
      ) order by x.due_date)
      from (
        select ce.id, ce.case_id, c.title, ce.expense_type, ce.amount, ce.due_date
        from public.case_expenses ce
        join public.cases c on c.id = ce.case_id
        where ce.firm_id = v_firm
          and ce.deleted_at is null
          and ce.payment_status = 'غير مدفوع'
          and ce.due_date is not null
          and ce.due_date <= (current_date + v_days)
          and private.can_access_case(ce.case_id)
        order by ce.due_date
        limit 50
      ) x
    ), '[]'::jsonb),
    'over_budget', coalesce((
      select jsonb_agg(jsonb_build_object(
        'case_id', y.case_id,
        'case_title', y.title,
        'expense_budget', y.expense_budget,
        'total_expenses', y.total_expenses
      ))
      from (
        select c.id as case_id, c.title, c.expense_budget,
               coalesce(sum(ce.amount), 0) as total_expenses
        from public.cases c
        left join public.case_expenses ce
          on ce.case_id = c.id and ce.deleted_at is null
        where c.firm_id = v_firm
          and c.deleted_at is null
          and c.expense_budget is not null
          and private.can_access_case(c.id)
        group by c.id, c.title, c.expense_budget
        having coalesce(sum(ce.amount), 0) > c.expense_budget
        limit 50
      ) y
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.add_case_expense(uuid, text, numeric, date, text, text, text, text, text, date, text, text) from public;
revoke all on function public.update_case_expense(uuid, text, numeric, date, text, text, text, text, text, date, text, text, boolean) from public;
revoke all on function public.soft_delete_case_expense(uuid) from public;
revoke all on function public.add_case_expense_type(text) from public;
revoke all on function public.get_case_expenses_report(date, date, text, uuid, text, uuid, uuid, text) from public;
revoke all on function public.get_case_expense_alerts(integer) from public;

grant execute on function public.add_case_expense(uuid, text, numeric, date, text, text, text, text, text, date, text, text) to authenticated;
grant execute on function public.update_case_expense(uuid, text, numeric, date, text, text, text, text, text, date, text, text, boolean) to authenticated;
grant execute on function public.soft_delete_case_expense(uuid) to authenticated;
grant execute on function public.add_case_expense_type(text) to authenticated;
grant execute on function public.get_case_expenses_report(date, date, text, uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.get_case_expense_alerts(integer) to authenticated;
