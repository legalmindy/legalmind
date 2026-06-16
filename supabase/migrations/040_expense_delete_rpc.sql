-- Migration 040: SECURITY DEFINER RPC for expense soft-delete
-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause: The expenses_update RLS policy has no explicit WITH CHECK clause.
-- PostgreSQL defaults WITH CHECK = USING, which includes `deleted_at IS NULL`.
-- When we try to set deleted_at = now(), the new row fails the check silently.
--
-- Solution: A SECURITY DEFINER function that runs as the DB owner and bypasses
-- RLS entirely, but enforces its own admin + firm checks internally.
-- This is the standard Supabase pattern for operations that require elevated
-- privileges while still enforcing business rules.
-- ─────────────────────────────────────────────────────────────────────────────

-- Also fix the broken UPDATE policy so direct UPDATEs work too (future-proof)
DROP POLICY IF EXISTS "expenses_update" ON public.office_expenses;

CREATE POLICY "expenses_update" ON public.office_expenses
  FOR UPDATE
  USING (
    firm_id   = (SELECT private.get_current_firm_id())
    AND deleted_at IS NULL
    AND (SELECT private.is_office_admin())
  )
  WITH CHECK (
    -- intentionally omit `deleted_at IS NULL` so soft-delete is allowed
    firm_id = (SELECT private.get_current_firm_id())
    AND (SELECT private.is_office_admin())
  );

-- ─── SECURITY DEFINER soft-delete function ────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_office_expense(expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_firm_id  uuid;
  v_affected int;
BEGIN
  -- 1. Verify caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING errcode = 'P0001';
  END IF;

  -- 2. Get caller's firm
  v_firm_id := private.get_current_firm_id();

  -- 3. Only firm admins may delete expenses
  IF NOT private.is_office_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: only office admins can delete expenses'
      USING errcode = 'P0001';
  END IF;

  -- 4. Soft-delete — only rows that belong to this firm and are not yet deleted
  UPDATE public.office_expenses
  SET    deleted_at = now()
  WHERE  id         = expense_id
    AND  firm_id    = v_firm_id
    AND  deleted_at IS NULL;

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected = 0 THEN
    RAISE EXCEPTION 'NOT_FOUND: expense not found or already deleted'
      USING errcode = 'P0002';
  END IF;
END;
$$;

-- Grant execute to authenticated users (the function enforces its own checks)
GRANT EXECUTE ON FUNCTION public.delete_office_expense(uuid) TO authenticated;
