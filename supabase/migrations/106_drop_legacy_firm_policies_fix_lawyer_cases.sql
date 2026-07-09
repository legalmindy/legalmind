-- 106: Fix lawyer seeing unassigned cases — drop legacy firm-wide RLS policies
--
-- Root cause: migration 001 created cases_select_firm (any firm member → all cases).
-- Migration 002 drops it, but if that drop never ran (or DB was seeded from 001 only),
-- cases_select_firm ORs with the restrictive cases_select and lawyers see everything.
--
-- Surgical: drop legacy *_firm / *_role_scoped policies on cases + related tables,
-- add small helpers, re-assert lawyer-scoped policies. No pre-auth / login changes.

-- ─── 1) Drop legacy overlapping policies ─────────────────────────────────────
drop policy if exists "cases_select_firm" on public.cases;
drop policy if exists cases_select_firm on public.cases;
drop policy if exists "cases_select_role_scoped" on public.cases;
drop policy if exists cases_select_role_scoped on public.cases;
drop policy if exists "cases_update_firm" on public.cases;
drop policy if exists cases_update_firm on public.cases;
drop policy if exists "cases_update_role_scoped" on public.cases;
drop policy if exists cases_update_role_scoped on public.cases;

drop policy if exists "sessions_select_firm" on public.sessions;
drop policy if exists sessions_select_firm on public.sessions;
drop policy if exists "documents_select_firm" on public.documents;
drop policy if exists documents_select_firm on public.documents;

drop policy if exists "clients_select_firm" on public.clients;
drop policy if exists clients_select_firm on public.clients;
drop policy if exists "clients_select_role_scoped" on public.clients;
drop policy if exists clients_select_role_scoped on public.clients;

-- ─── 2) Shared helpers (idempotent) ──────────────────────────────────────────
create or replace function private.is_scoped_lawyer()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(
    private.get_current_role() = 'lawyer'::public.employee_role_enum
    or (
      private.get_current_lawyer_id() is not null
      and private.get_current_role() not in (
        'super_admin'::public.employee_role_enum,
        'admin'::public.employee_role_enum,
        'firm_manager'::public.employee_role_enum
      )
    ),
    false
  );
$$;

create or replace function private.is_office_assistant()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(
    private.get_current_role() = 'assistant'::public.employee_role_enum
    and private.get_current_lawyer_id() is null
    and not private.is_office_admin(),
    false
  );
$$;

revoke all on function private.is_scoped_lawyer() from public, anon;
grant execute on function private.is_scoped_lawyer() to authenticated, service_role;

revoke all on function private.is_office_assistant() from public, anon;
grant execute on function private.is_office_assistant() to authenticated, service_role;

-- ─── 3) Case access gate (sessions, documents, payments, timeline) ───────────
create or replace function private.can_access_case(target_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case_id
      and c.firm_id = private.get_current_firm_id()
      and c.deleted_at is null
      and (
        private.is_office_admin()
        or (
          private.is_scoped_lawyer()
          and c.assigned_lawyer_id is not null
          and c.assigned_lawyer_id = private.get_current_lawyer_id()
        )
        or private.is_office_assistant()
      )
  );
$$;

revoke all on function private.can_access_case(uuid) from public, anon;
grant execute on function private.can_access_case(uuid) to authenticated, service_role;

-- ─── 4) Client access gate ───────────────────────────────────────────────────
create or replace function private.can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select exists (
    select 1
    from public.clients cl
    where cl.id = target_client_id
      and cl.firm_id = private.get_current_firm_id()
      and cl.deleted_at is null
      and (
        private.is_office_admin()
        or private.is_office_assistant()
        or (
          private.is_scoped_lawyer()
          and exists (
            select 1
            from public.cases c
            where c.client_id = cl.id
              and c.firm_id = cl.firm_id
              and c.deleted_at is null
              and c.assigned_lawyer_id is not null
              and c.assigned_lawyer_id = private.get_current_lawyer_id()
          )
        )
      )
  );
$$;

revoke all on function private.can_access_client(uuid) from public, anon;
grant execute on function private.can_access_client(uuid) to authenticated, service_role;

-- ─── 5) clients SELECT ───────────────────────────────────────────────────────
drop policy if exists "clients_select_role_scoped" on public.clients;
drop policy if exists clients_select on public.clients;
drop policy if exists "clients_select" on public.clients;

create policy clients_select on public.clients
  for select
  to authenticated
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (
      (select private.is_office_admin())
      or (select private.is_office_assistant())
      or (
        (select private.is_scoped_lawyer())
        and exists (
          select 1
          from public.cases c
          where c.client_id = clients.id
            and c.firm_id = clients.firm_id
            and c.deleted_at is null
            and c.assigned_lawyer_id is not null
            and c.assigned_lawyer_id = (select private.get_current_lawyer_id())
        )
      )
    )
  );

-- ─── 6) cases SELECT / UPDATE (single authoritative policy) ──────────────────
drop policy if exists "cases_select_role_scoped" on public.cases;
drop policy if exists cases_select on public.cases;
drop policy if exists "cases_select" on public.cases;

create policy cases_select on public.cases
  for select
  to authenticated
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and (
      (
        deleted_at is null
        and (
          (select private.is_office_admin())
          or (
            (select private.is_scoped_lawyer())
            and assigned_lawyer_id is not null
            and assigned_lawyer_id = (select private.get_current_lawyer_id())
          )
          or (select private.is_office_assistant())
        )
      )
      or (
        deleted_at is not null
        and (select private.is_office_admin())
      )
    )
  );

drop policy if exists "cases_update_role_scoped" on public.cases;
drop policy if exists cases_update on public.cases;
drop policy if exists "cases_update" on public.cases;

create policy cases_update on public.cases
  for update
  to authenticated
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and (
      (select private.is_office_admin())
      or (select private.has_permission('cases.edit'))
      or (
        (select private.is_office_assistant())
        and deleted_at is null
      )
      or (
        (select private.is_scoped_lawyer())
        and deleted_at is null
        and assigned_lawyer_id is not null
        and assigned_lawyer_id = (select private.get_current_lawyer_id())
      )
    )
  )
  with check (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
  );

notify pgrst, 'reload schema';
