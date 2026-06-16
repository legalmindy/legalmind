-- ═══════════════════════════════════════════════════════════════════════════════
-- LegalMind Yemen — Migration 034: Performance, Hardening & Professional DB
-- Run after: 033_fix_cancel_invitation.sql
--
-- What this migration does:
--   1. Enable pg_trgm for Arabic/Latin fuzzy text search
--   2. Add GIN trigram indexes for client/case search
--   3. Add missing FK indexes (invitations, sessions, execution_requests, …)
--   4. Add partial/composite indexes for hot query paths
--   5. Fix multiple-permissive-policy on subscription_requests (linter warning)
--   6. Add cross-tenant CHECK trigger for execution_requests
--   7. Add unique constraint: one pending subscription request per firm
--   8. Add firm_id column to sessions for direct firm-scoped queries
--   9. Database maintenance helpers (auto-vacuum tuning comments)
--  10. Add db retention/TTL helper for audit_logs + error_logs
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1) pg_trgm extension (fuzzy text search) ────────────────────────────────
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to authenticated, anon, service_role;

-- ─── 2) GIN trigram indexes for Arabic/Latin search ─────────────────────────

-- Clients: name & phone search
drop index if exists public.idx_clients_name_trgm;
create index idx_clients_name_trgm
  on public.clients using gin (name extensions.gin_trgm_ops)
  where deleted_at is null;

drop index if exists public.idx_clients_phone_trgm;
create index idx_clients_phone_trgm
  on public.clients using gin (phone extensions.gin_trgm_ops)
  where phone is not null and deleted_at is null;

-- Cases: title & court_case_number search
drop index if exists public.idx_cases_title_trgm;
create index idx_cases_title_trgm
  on public.cases using gin (title extensions.gin_trgm_ops)
  where deleted_at is null;

drop index if exists public.idx_cases_court_case_number_trgm;
create index idx_cases_court_case_number_trgm
  on public.cases using gin (court_case_number extensions.gin_trgm_ops)
  where deleted_at is null;

-- Employees: full_name search
drop index if exists public.idx_employees_name_trgm;
create index idx_employees_name_trgm
  on public.employees using gin (full_name extensions.gin_trgm_ops)
  where deleted_at is null;

-- ─── 3) Missing FK indexes ────────────────────────────────────────────────────

-- invitations.invited_by, invitations.employee_id
create index if not exists idx_invitations_invited_by
  on public.invitations (invited_by)
  where invited_by is not null;

create index if not exists idx_invitations_employee_id
  on public.invitations (employee_id)
  where employee_id is not null;

-- sessions.scheduled_by
create index if not exists idx_sessions_scheduled_by
  on public.sessions (scheduled_by)
  where scheduled_by is not null;

-- case_attachments.uploaded_by
create index if not exists idx_case_attachments_uploaded_by
  on public.case_attachments (uploaded_by)
  where uploaded_by is not null;

-- cases.closed_by
create index if not exists idx_cases_closed_by
  on public.cases (closed_by)
  where closed_by is not null;

-- audit_logs.changed_by
create index if not exists idx_audit_logs_changed_by
  on public.audit_logs (changed_by)
  where changed_by is not null;

-- error_logs.firm_id, error_logs.employee_id
create index if not exists idx_error_logs_firm_id
  on public.error_logs (firm_id, created_at desc)
  where firm_id is not null;

create index if not exists idx_error_logs_employee_id
  on public.error_logs (employee_id)
  where employee_id is not null;

-- sync_events.created_by
create index if not exists idx_sync_events_created_by
  on public.sync_events (created_by)
  where created_by is not null;

-- subscription_requests.submitted_by, reviewed_by
create index if not exists idx_subscription_requests_submitted_by
  on public.subscription_requests (submitted_by);

create index if not exists idx_subscription_requests_reviewed_by
  on public.subscription_requests (reviewed_by)
  where reviewed_by is not null;

-- execution_requests.client_id, case_id, created_by
create index if not exists idx_execution_requests_client_id
  on public.execution_requests (client_id)
  where client_id is not null and deleted_at is null;

create index if not exists idx_execution_requests_case_id
  on public.execution_requests (case_id)
  where case_id is not null and deleted_at is null;

create index if not exists idx_execution_requests_created_by
  on public.execution_requests (created_by)
  where created_by is not null;

-- client_report_logs.client_id, sent_by
create index if not exists idx_client_report_logs_client_id
  on public.client_report_logs (client_id, created_at desc);

create index if not exists idx_client_report_logs_sent_by
  on public.client_report_logs (sent_by)
  where sent_by is not null;

-- ─── 4) Partial / composite indexes for hot query paths ──────────────────────

-- Active clients per firm (main list view)
drop index if exists public.idx_clients_active_firm;
create index idx_clients_active_firm
  on public.clients (firm_id, created_at desc)
  where deleted_at is null;

-- Active cases per firm (most common query)
drop index if exists public.idx_cases_active_firm;
create index idx_cases_active_firm
  on public.cases (firm_id, status, updated_at desc)
  where deleted_at is null;

-- Cases by lawyer (dashboard widget)
drop index if exists public.idx_cases_lawyer_active;
create index idx_cases_lawyer_active
  on public.cases (assigned_lawyer_id, firm_id)
  where deleted_at is null and status = 'active';

-- Offline sync: firm_id-prefixed covering indexes (dominant sync pattern)
drop index if exists public.idx_clients_firm_sync;
create index idx_clients_firm_sync
  on public.clients (firm_id, updated_at, sync_version)
  where deleted_at is null;

drop index if exists public.idx_cases_firm_sync;
create index idx_cases_firm_sync
  on public.cases (firm_id, updated_at, sync_version)
  where deleted_at is null;

drop index if exists public.idx_employees_firm_sync;
create index idx_employees_firm_sync
  on public.employees (firm_id, updated_at, sync_version)
  where deleted_at is null;

drop index if exists public.idx_sessions_sync;
create index idx_sessions_sync
  on public.sessions (case_id, updated_at, sync_version)
  where deleted_at is null;

-- Sessions: calendar view by date per case
drop index if exists public.idx_sessions_case_date;
create index idx_sessions_case_date
  on public.sessions (case_id, session_date)
  where deleted_at is null;

-- Pending invitations expiry sweep (called on every invite RPC)
drop index if exists public.idx_invitations_pending_expiry;
create index idx_invitations_pending_expiry
  on public.invitations (expires_at)
  where status = 'pending';

-- Unread notifications inbox (most frequent notification query)
drop index if exists public.idx_notifications_unread;
create index idx_notifications_unread
  on public.notifications (firm_id, employee_id, created_at desc)
  where read = false;

-- Subscription expiry batch job (expire_stale_firm_subscriptions)
drop index if exists public.idx_firms_subscription_expiry;
create index idx_firms_subscription_expiry
  on public.firms (subscription_expires_at)
  where subscription_status in ('trial', 'active') and not is_locked;

-- Active firms (subscription RLS helper)
drop index if exists public.idx_firms_active;
create index idx_firms_active
  on public.firms (id, subscription_status, subscription_expires_at)
  where deleted_at is null;

-- Execution requests dashboard
drop index if exists public.idx_execution_requests_active;
create index idx_execution_requests_active
  on public.execution_requests (firm_id, status, due_date)
  where deleted_at is null;

-- ─── 5) Fix multiple-permissive SELECT on subscription_requests ──────────────
-- Both policies are SELECT, which causes a linter warning (AND logic is fine
-- but the linter flags it). Consolidate into one policy.
drop policy if exists "subscription_requests_select" on public.subscription_requests;
drop policy if exists "subscription_requests_select_platform" on public.subscription_requests;

create policy "subscription_requests_select" on public.subscription_requests
  for select
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_platform_operator())
  );

-- ─── 6) Cross-tenant validation for execution_requests ───────────────────────
create or replace function private.validate_execution_request_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- Validate client belongs to same firm
  if new.client_id is not null then
    if not exists (
      select 1 from public.clients
      where id = new.client_id and firm_id = new.firm_id and deleted_at is null
    ) then
      raise exception 'client_id does not belong to the same firm';
    end if;
  end if;

  -- Validate case belongs to same firm
  if new.case_id is not null then
    if not exists (
      select 1 from public.cases
      where id = new.case_id and firm_id = new.firm_id and deleted_at is null
    ) then
      raise exception 'case_id does not belong to the same firm';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_execution_request_tenant on public.execution_requests;
create trigger trg_validate_execution_request_tenant
  before insert or update of client_id, case_id on public.execution_requests
  for each row execute function private.validate_execution_request_tenant();

-- ─── 7) Unique constraint: one PENDING subscription request per firm ─────────
drop index if exists public.idx_subscription_requests_pending_unique;
create unique index idx_subscription_requests_pending_unique
  on public.subscription_requests (firm_id)
  where status = 'pending';

-- ─── 8) Add firm_id to sessions (denormalization for direct firm-scoped queries)
-- Sessions currently join via cases to find firm_id.
-- Adding firm_id directly avoids the join in sync and calendar queries.
alter table public.sessions
  add column if not exists firm_id uuid references public.firms(id) on delete cascade;

-- Back-fill existing rows from their parent case
update public.sessions s
set firm_id = c.firm_id
from public.cases c
where s.case_id = c.id and s.firm_id is null;

-- Index for direct firm-scoped session queries
drop index if exists public.idx_sessions_firm_date;
create index idx_sessions_firm_date
  on public.sessions (firm_id, session_date)
  where deleted_at is null;

drop index if exists public.idx_sessions_firm_sync;
create index idx_sessions_firm_sync
  on public.sessions (firm_id, updated_at, sync_version)
  where deleted_at is null;

-- Trigger to auto-populate firm_id on new sessions
create or replace function private.set_session_firm_id()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.firm_id is null then
    select firm_id into new.firm_id
    from public.cases where id = new.case_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_session_firm_id on public.sessions;
create trigger trg_set_session_firm_id
  before insert on public.sessions
  for each row execute function private.set_session_firm_id();

-- ─── 9) Retention helpers (audit_logs & error_logs TTL) ──────────────────────
-- Call these via pg_cron or a scheduled Edge Function.

create or replace function public.purge_old_audit_logs(retention_days integer default 365)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.audit_logs
  where created_at < now() - (retention_days || ' days')::interval;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_old_audit_logs(integer) from public;
grant execute on function public.purge_old_audit_logs(integer) to service_role;

create or replace function public.purge_old_error_logs(retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.error_logs
  where created_at < now() - (retention_days || ' days')::interval
    and severity not in ('critical');
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_old_error_logs(integer) from public;
grant execute on function public.purge_old_error_logs(integer) to service_role;

-- Cancelled/expired invitations cleanup (older than 90 days)
create or replace function public.purge_old_invitations(retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.invitations
  where status in ('cancelled', 'expired')
    and created_at < now() - (retention_days || ' days')::interval;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_old_invitations(integer) from public;
grant execute on function public.purge_old_invitations(integer) to service_role;

-- ─── 10) Statistics: ensure planner uses fresh stats ─────────────────────────
-- Run ANALYZE on the most queried tables.
-- (Supabase auto-analyzes but running here on migration ensures immediate effect.)
analyze public.firms;
analyze public.employees;
analyze public.profiles;
analyze public.clients;
analyze public.cases;
analyze public.sessions;
analyze public.invitations;
analyze public.notifications;
analyze public.execution_requests;
