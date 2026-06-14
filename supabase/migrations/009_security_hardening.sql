-- LegalMind Yemen — Supabase linter security hardening
-- Fixes: function_search_path_mutable, anon/authenticated SECURITY DEFINER RPC exposure

-- ─── 1) Pin search_path on all public functions ───────────────────────────────
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('alter function %s set search_path = public', fn.signature);
  end loop;
end $$;

-- ─── 2) Revoke default PUBLIC execute on all public functions ─────────────────
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public', fn.signature);
    execute format('revoke all on function %s from anon', fn.signature);
    execute format('revoke all on function %s from authenticated', fn.signature);
  end loop;
end $$;

-- ─── 3) Grant RPC access only where the app needs it ──────────────────────────

-- Pre-login registration / invite preview (anon + authenticated)
grant execute on function public.office_code_exists(text) to anon, authenticated;
grant execute on function public.get_office_by_code(text) to anon, authenticated;

do $$ begin
  grant execute on function public.get_office_by_firm_code(text) to anon, authenticated;
exception when undefined_function then null;
end $$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- Authenticated app RPCs
grant execute on function public.get_current_profile_context() to authenticated;
grant execute on function public.is_current_user_office_admin() to authenticated;
grant execute on function public.accept_invitation_for_auth_user(text) to authenticated;
grant execute on function public.create_office_invitation(text, text, text) to authenticated;
grant execute on function public.cancel_office_invitation(uuid) to authenticated;
grant execute on function public.resend_office_invitation(uuid, text) to authenticated;
grant execute on function public.sync_pull_table(text, text) to authenticated;
grant execute on function public.sync_apply_event(text, text, uuid, uuid, text, jsonb) to authenticated;

-- Internal helpers, triggers, and RLS functions stay revoked from anon/authenticated.
-- They remain callable from other SECURITY DEFINER functions and via service_role.
