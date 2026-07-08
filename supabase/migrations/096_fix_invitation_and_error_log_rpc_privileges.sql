-- 096: Restore SECURITY DEFINER on client RPCs wrongly downgraded to INVOKER by 083
--
-- Root cause:
--   Migration 083 (step 2) converted every public SECURITY DEFINER function whose
--   body did NOT literally contain 'row_security' or 'auth.users' into SECURITY
--   INVOKER. The invitation RPCs and the client error-log RPC don't contain those
--   strings, so they were downgraded. As INVOKER they run as the caller and fail:
--     • create_office_invitation → calls public.expire_old_invitations() whose
--       execute grant was revoked in 083 step 6  → "permission denied for function
--       expire_old_invitations" (403)
--     • cancel/resend_office_invitation → blocked writing to public.invitations
--     • submit_client_error_log → blocked writing to public.error_logs
--
-- These routines authorize internally (private.is_firm_manager / auth.uid checks),
-- so SECURITY DEFINER is the correct and intended posture. Flip the flag back and
-- re-assert the authenticated grants.

do $$
declare
  fn text;
  fns text[] := array[
    'public.create_office_invitation(text, text, text, text, text, uuid)',
    'public.cancel_office_invitation(uuid)',
    'public.resend_office_invitation(uuid, text)',
    'public.submit_client_error_log(text, text, jsonb, text)'
  ];
begin
  foreach fn in array fns loop
    begin
      execute format('alter function %s security definer', fn);
      execute format('revoke all on function %s from public, anon', fn);
      execute format('grant execute on function %s to authenticated', fn);
    exception
      when undefined_function then
        raise notice 'Skipped missing function: %', fn;
    end;
  end loop;
end $$;

-- Ensure the SECURITY DEFINER callers (owner) retain execute on the internal
-- expiry helper. Owner keeps execute even after the 083 public revoke, so no
-- client grant is added here (keeps it non-client-callable per 083's intent).

notify pgrst, 'reload schema';
