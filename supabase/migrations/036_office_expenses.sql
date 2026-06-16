-- Migration 036: Office expenses table
-- Enables the financial reports page to track office expenses (rent, salaries,
-- supplies, etc.) and compute monthly net profit = revenue - expenses.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.office_expenses (
  id           uuid          primary key default gen_random_uuid(),
  firm_id      uuid          not null references public.firms(id) on delete cascade,
  title        text          not null check (char_length(trim(title)) >= 2),
  amount       numeric(12,2) not null check (amount >= 0),
  category     text          not null default 'عام',
  expense_date date          not null default current_date,
  notes        text,
  created_by   uuid          references public.employees(id) on delete set null,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  deleted_at   timestamptz
);

-- Fast date-range queries per firm
create index if not exists idx_expenses_firm_date
  on public.office_expenses(firm_id, expense_date desc)
  where deleted_at is null;

-- updated_at auto-maintenance
create or replace function private.touch_expenses_updated_at()
returns trigger language plpgsql as $$
begin NEW.updated_at := now(); return NEW; end;
$$;

drop trigger if exists trg_expenses_updated_at on public.office_expenses;
create trigger trg_expenses_updated_at
  before update on public.office_expenses
  for each row execute function private.touch_expenses_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.office_expenses enable row level security;

-- Only firm admins / firm_managers can see, insert, update, delete expenses
create policy "expenses_select" on public.office_expenses for select
  using (
    (select private.is_firm_subscription_active())
    and firm_id   = (select private.get_current_firm_id())
    and deleted_at is null
    and (select private.is_office_admin())
  );

create policy "expenses_insert" on public.office_expenses for insert
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  );

create policy "expenses_update" on public.office_expenses for update
  using (
    firm_id   = (select private.get_current_firm_id())
    and deleted_at is null
    and (select private.is_office_admin())
  );

-- Soft-delete only; no hard DELETE policy — use UPDATE set deleted_at = now()
-- (matches the pattern used for clients / cases / employees in this repo)

grant select, insert, update on public.office_expenses to authenticated;
