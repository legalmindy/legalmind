-- Migration 037: Fix soft-delete on office_expenses
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem: The expenses_update policy has no explicit WITH CHECK clause.
-- PostgreSQL defaults WITH CHECK to the same USING expression, which includes
--   `deleted_at is null`
-- This causes a silent failure when we try to soft-delete a row by setting
--   deleted_at = now(), because the NEW row no longer satisfies the check.
--
-- Fix: drop and recreate the policy with a separate WITH CHECK that allows
-- the deleted_at column to be written.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "expenses_update" on public.office_expenses;

create policy "expenses_update" on public.office_expenses
  for update
  using (
    firm_id   = (select private.get_current_firm_id())
    and deleted_at is null
    and (select private.is_office_admin())
  )
  with check (
    -- Only check firm isolation and admin role on the new row.
    -- Intentionally omit `deleted_at is null` so that soft-deletes
    -- (setting deleted_at = now()) are permitted.
    firm_id = (select private.get_current_firm_id())
    and (select private.is_office_admin())
  );
