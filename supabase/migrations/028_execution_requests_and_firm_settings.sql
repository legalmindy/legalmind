-- Execution requests + firm notification settings
-- Run after 027_supabase_linter_hardening.sql

alter table public.firms add column if not exists reminders_enabled boolean not null default true;
alter table public.firms add column if not exists whatsapp_reports_enabled boolean not null default true;
alter table public.firms add column if not exists sms_reports_enabled boolean not null default false;
alter table public.firms add column if not exists hide_financials_from_trainees boolean not null default true;

create table if not exists public.execution_requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  title text not null check (char_length(trim(title)) >= 2),
  court text not null default '',
  request_number text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'rejected')),
  notes text,
  due_date date,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_execution_requests_firm on public.execution_requests(firm_id, created_at desc);
create index if not exists idx_execution_requests_status on public.execution_requests(status);

drop trigger if exists set_updated_at_execution_requests on public.execution_requests;
create trigger set_updated_at_execution_requests
  before update on public.execution_requests
  for each row execute function public.set_updated_at();

create table if not exists public.client_report_logs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'sms')),
  message_body text not null,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_client_report_logs_firm on public.client_report_logs(firm_id, created_at desc);

alter table public.execution_requests enable row level security;
alter table public.client_report_logs enable row level security;

drop policy if exists "execution_requests_select" on public.execution_requests;
drop policy if exists "execution_requests_insert" on public.execution_requests;
drop policy if exists "execution_requests_update" on public.execution_requests;
drop policy if exists "execution_requests_delete" on public.execution_requests;

create policy "execution_requests_select" on public.execution_requests for select
  using (
    firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (select private.is_firm_subscription_active())
  );

create policy "execution_requests_insert" on public.execution_requests for insert
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_firm_subscription_active())
    and (select private.get_current_role()) in ('super_admin','admin','firm_manager','assistant','lawyer')
  );

create policy "execution_requests_update" on public.execution_requests for update
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_firm_subscription_active())
  )
  with check (firm_id = (select private.get_current_firm_id()));

create policy "execution_requests_delete" on public.execution_requests for delete
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  );

drop policy if exists "client_report_logs_select" on public.client_report_logs;
drop policy if exists "client_report_logs_insert" on public.client_report_logs;

create policy "client_report_logs_select" on public.client_report_logs for select
  using (firm_id = (select private.get_current_firm_id()));

create policy "client_report_logs_insert" on public.client_report_logs for insert
  with check (
    firm_id = (select private.get_current_firm_id())
    and sent_by = (select auth.uid())
  );
