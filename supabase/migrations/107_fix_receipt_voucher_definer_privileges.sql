-- 107: Restore SECURITY DEFINER on receipt / payment RPCs (same class of bug as 096)
--
-- Symptom (production console):
--   POST .../rpc/create_receipt_voucher → 403
--   UI toast: "permission denied for function next_receipt_number"
--
-- Root cause:
--   Migration 083 step 2 flipped public SECURITY DEFINER RPCs whose bodies do not
--   literally contain 'row_security' / 'auth.users' to SECURITY INVOKER.
--   create_receipt_voucher / reprint_receipt_voucher / add_case_payment were
--   downgraded. create_receipt_voucher then runs as the caller and fails when it
--   invokes public.next_receipt_number(), whose EXECUTE was intentionally revoked
--   from authenticated in 063 / 081 (internal helper only).
--
-- Migration 102 only wraps functions that are STILL SECURITY DEFINER, so these
-- INVOKER bodies were never moved into private.*_svc — they stayed broken.
--
-- Fix: restore SECURITY DEFINER (they authorize via private.can_* helpers), keep
-- next_receipt_number non-callable by clients, re-grant EXECUTE on the public RPCs.

do $$
declare
  fn text;
  fns text[] := array[
    'public.create_receipt_voucher(uuid)',
    'public.reprint_receipt_voucher(uuid)',
    'public.add_case_payment(uuid, numeric, date, text, text, text, text)',
    'public.append_case_timeline_event(uuid, text, text, text, jsonb)'
  ];
begin
  foreach fn in array fns loop
    begin
      execute format('alter function %s security definer', fn);
      -- Keep search_path pinned (defense in depth for DEFINER routines).
      execute format(
        'alter function %s set search_path = public, private, extensions, auth',
        fn
      );
      execute format('revoke all on function %s from public, anon', fn);
      execute format('grant execute on function %s to authenticated', fn);
    exception
      when undefined_function then
        raise notice 'Skipped missing function: %', fn;
    end;
  end loop;
end $$;

-- Internal sequencer: clients must never call it directly. DEFINER owners of the
-- RPCs above retain EXECUTE as function owners / same-role callers.
revoke all on function public.next_receipt_number(uuid) from public;
revoke all on function public.next_receipt_number(uuid) from anon;
revoke all on function public.next_receipt_number(uuid) from authenticated;
-- Ensure the helper itself stays DEFINER with a safe search_path.
alter function public.next_receipt_number(uuid) security definer;
alter function public.next_receipt_number(uuid) set search_path = public, private;

notify pgrst, 'reload schema';
