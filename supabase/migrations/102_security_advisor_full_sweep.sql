-- 102: Supabase Security Advisor — full sweep (post 096–101)
--
-- Clears the common linter warnings without re-breaking app flows:
--   • Function Search Path Mutable
--   • Signed-In / Public Can Execute SECURITY DEFINER (public schema)
--   • Auth RLS Initialization Plan (auth.uid / auth.jwt)
--   • Multiple Permissive Policies (known duplicates)
--   • Security Definer View (firms_registration_public)
--
-- Strategy (same as 083, but WITHOUT the harmful step-2 blind INVOKER downgrade):
--   elevated public RPCs → private.*_svc (DEFINER) + public SECURITY INVOKER wrapper
--
-- Dashboard (manual, cannot be SQL): Authentication → Password Security → leaked-password protection

notify pgrst, 'reload schema';

-- ─── 1) Pin search_path on every routine ─────────────────────────────────────
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, n.nspname as schema_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind in ('f', 'p')
  loop
    begin
      execute format(
        'alter function %s set search_path = %I, public, extensions, auth',
        fn.signature,
        fn.schema_name
      );
    exception when others then
      raise notice 'search_path skip: %', fn.signature;
    end;
  end loop;
end $$;

-- ─── 2) firms_registration_public stays INVOKER (lint 0010) ────────────────
create or replace view public.firms_registration_public
with (security_invoker = true) as
select
  f.id,
  f.name,
  f.firm_code::text as firm_code
from public.firms f
where f.deleted_at is null
  and f.firm_code is not null;

grant select on public.firms_registration_public to anon, authenticated;
grant select (id, name, firm_code) on public.firms to anon;

drop policy if exists firms_select_registration on public.firms;
create policy firms_select_registration on public.firms
  for select
  to anon
  using (deleted_at is null and firm_code is not null);

-- ─── 3) Drop known duplicate permissive policies ─────────────────────────────
drop policy if exists "employees_select_own_auth" on public.employees;
drop policy if exists "subscription_requests_select_super_admin" on public.subscription_requests;
drop policy if exists "subscription_requests_insert_firm" on public.subscription_requests;
drop policy if exists invitations_anon_preview_by_token on public.invitations;
drop policy if exists "invitations_select" on public.invitations;
drop policy if exists firm_roles_anon_registration_read on public.firm_roles;
drop policy if exists firm_roles_invitation_preview on public.firm_roles;
drop policy if exists "firms_select_billing_admin" on public.firms;
drop policy if exists public_testimonials_select_approved on public.public_testimonials;
drop policy if exists public_testimonials_super_admin_all on public.public_testimonials;
drop policy if exists public_testimonials_insert_public on public.public_testimonials;
drop policy if exists "documents_select_case_access" on public.documents;
drop policy if exists "sessions_select_case_access" on public.sessions;

-- ─── 4) Auth RLS initplan: wrap bare auth.uid() / auth.jwt() ────────────────
do $$
declare
  p record;
  v_qual text;
  v_check text;
  v_roles text;
  v_changed boolean;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    v_qual := p.qual;
    v_check := p.with_check;
    v_changed := false;

    if v_qual is not null and v_qual ~ 'auth\.uid\(\)' and v_qual !~ '\(select auth\.uid\(\)\)' then
      v_qual := regexp_replace(v_qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      v_changed := true;
    end if;
    if v_check is not null and v_check ~ 'auth\.uid\(\)' and v_check !~ '\(select auth\.uid\(\)\)' then
      v_check := regexp_replace(v_check, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      v_changed := true;
    end if;
    if v_qual is not null and v_qual ~ 'auth\.jwt\(\)' and v_qual !~ '\(select auth\.jwt\(\)\)' then
      v_qual := regexp_replace(v_qual, 'auth\.jwt\(\)', '(select auth.jwt())', 'g');
      v_changed := true;
    end if;
    if v_check is not null and v_check ~ 'auth\.jwt\(\)' and v_check !~ '\(select auth\.jwt\(\)\)' then
      v_check := regexp_replace(v_check, 'auth\.jwt\(\)', '(select auth.jwt())', 'g');
      v_changed := true;
    end if;

    if not v_changed then
      continue;
    end if;

    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    v_roles := array_to_string(p.roles, ', ');
    execute format(
      'create policy %I on %I.%I as %s for %s to %s %s %s',
      p.policyname,
      p.schemaname,
      p.tablename,
      lower(p.permissive),
      lower(p.cmd),
      v_roles,
      case when v_qual is not null then format('using (%s)', v_qual) else '' end,
      case when v_check is not null then format('with check (%s)', v_check) else '' end
    );
  end loop;
end $$;

-- ─── 5) ALL client public DEFINER RPCs → private *_svc + public INVOKER ─────
-- (Broader than 083: every DEFINER RPC, not only row_security/auth.users bodies.)
do $$
declare
  r record;
  svc_def text;
  arg_call text;
  wrapper_body text;
  wrapper_sql text;
begin
  for r in
    select
      p.oid,
      p.proname,
      p.pronargs,
      p.proretset,
      pg_get_function_identity_arguments(p.oid) as idargs,
      pg_get_function_arguments(p.oid) as fullargs,
      pg_get_function_result(p.oid) as result,
      pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and p.proname not in (
        'handle_new_user',
        'sync_lawyer_profile',
        'expire_old_invitations',
        'next_receipt_number',
        'sync_case_paid_amount_from_payments',
        'secure_random_bytes',
        'normalize_yemeni_phone_for_storage',
        'sanitize_employee_phone',
        'purge_old_audit_logs',
        'purge_old_error_logs',
        'purge_old_invitations',
        'expire_stale_firm_subscriptions',
        'expire_stale_subscriptions',
        'seed_firm_role_templates',
        'repair_all_orphan_auth_profiles',
        'create_office_member_profile',
        'create_lawyer_profile',
        'invitation_hash'
      )
  loop
    if r.result = 'trigger' then
      continue;
    end if;

    if r.pronargs > 0 then
      select string_agg(format('$%s', i), ', ') into arg_call
      from generate_series(1, r.pronargs) as g(i);
    else
      arg_call := '';
    end if;

    execute format('drop function if exists private.%I_svc(%s) cascade', r.proname, r.idargs);

    svc_def := replace(
      r.def,
      'CREATE OR REPLACE FUNCTION public.' || r.proname || '(',
      'CREATE OR REPLACE FUNCTION private.' || r.proname || '_svc('
    );
    svc_def := regexp_replace(svc_def, '\msecurity\s+invoker\M', 'security definer', 'gi');
    execute svc_def;

    if r.result = 'void' then
      wrapper_body := format('perform private.%I_svc(%s);', r.proname, arg_call);
    elsif r.proretset then
      wrapper_body := format('return query select * from private.%I_svc(%s);', r.proname, arg_call);
    else
      wrapper_body := format('return private.%I_svc(%s);', r.proname, arg_call);
    end if;

    wrapper_sql := format(
      $w$
      create or replace function public.%1$I(%2$s)
      returns %3$s
      language plpgsql
      security invoker
      set search_path = public, private, extensions, auth
      as $b$
      begin
        %4$s
      end;
      $b$
      $w$,
      r.proname, r.fullargs, r.result, wrapper_body
    );

    execute wrapper_sql;

    execute format(
      'revoke all on function private.%I_svc(%s) from public, anon',
      r.proname, r.idargs
    );
    execute format(
      'grant execute on function private.%I_svc(%s) to authenticated, service_role',
      r.proname, r.idargs
    );
  end loop;
end $$;

-- ─── 6) No client execute on remaining public SECURITY DEFINER ─────────────
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
      and p.prosecdef
  loop
    begin
      execute format('revoke all on function %s from public', fn.signature);
      execute format('revoke all on function %s from anon', fn.signature);
      execute format('revoke all on function %s from authenticated', fn.signature);
    exception when others then
      raise notice 'definer revoke skip: %', fn.signature;
    end;
  end loop;
end $$;

-- ─── 7) Whitelist: public INVOKER RPC execute grants ─────────────────────────
do $$
declare
  grant_row record;
begin
  for grant_row in
    select *
    from (values
      ('public.normalize_firm_code(text)', 'anon, authenticated'),
      ('public.get_office_by_firm_code(text)', 'anon, authenticated'),
      ('public.get_office_by_code(text)', 'anon, authenticated'),
      ('public.office_code_exists(text)', 'anon, authenticated'),
      ('public.get_firm_roles_for_registration(text)', 'anon, authenticated'),
      ('public.is_valid_firm_code_format(text)', 'anon, authenticated'),
      ('public.get_platform_bank_details()', 'anon, authenticated'),
      ('public.list_approved_testimonials(integer)', 'anon, authenticated'),
      ('public.submit_public_testimonial(text, text, text, integer)', 'anon, authenticated'),
      ('public.log_security_event(text, text, jsonb, text)', 'anon, authenticated'),
      ('public.get_invitation_by_token(text)', 'anon, authenticated'),
      ('public.get_current_profile_context()', 'authenticated'),
      ('public.get_current_lawyer_id()', 'authenticated'),
      ('public.get_current_role()', 'authenticated'),
      ('public.accept_invitation_for_auth_user(text)', 'authenticated'),
      ('public.create_office_invitation(text, text, text, text, text, uuid)', 'authenticated'),
      ('public.create_office_invitation(text, text, text, text, text)', 'authenticated'),
      ('public.create_office_invitation(text, text, text)', 'authenticated'),
      ('public.cancel_office_invitation(uuid)', 'authenticated'),
      ('public.resend_office_invitation(uuid, text)', 'authenticated'),
      ('public.create_invited_profile(uuid, text, text, text)', 'authenticated'),
      ('public.delete_office_expense(uuid)', 'authenticated'),
      ('public.delete_client(uuid)', 'authenticated'),
      ('public.delete_execution_request(uuid)', 'authenticated'),
      ('public.is_platform_operator()', 'authenticated'),
      ('public.is_billing_admin()', 'authenticated, service_role'),
      ('public.is_subscription_super_admin()', 'authenticated, service_role'),
      ('public.can_access_super_admin_billing()', 'authenticated'),
      ('public.claim_billing_admin_setup()', 'authenticated'),
      ('public.list_pending_subscription_requests_admin()', 'authenticated'),
      ('public.review_subscription_request(uuid, text, text)', 'authenticated'),
      ('public.review_payment(uuid, text, text)', 'authenticated'),
      ('public.submit_subscription_request(text, numeric, text, text, text, uuid)', 'authenticated'),
      ('public.map_plan_to_plan_type(text)', 'authenticated, service_role'),
      ('public.saas_plan_duration_days(text)', 'authenticated, service_role'),
      ('public.subscription_plan_duration_days(text)', 'authenticated'),
      ('public.is_firm_subscription_active()', 'authenticated'),
      ('public.upsert_platform_bank_details(text, text, text, text, text)', 'authenticated'),
      ('public.sync_pull_table(text, text)', 'authenticated'),
      ('public.sync_apply_event(text, text, uuid, uuid, text, jsonb)', 'authenticated'),
      ('public.repair_current_user_profile()', 'authenticated'),
      ('public.add_case_payment(uuid, numeric, date, text, text, text, text)', 'authenticated'),
      ('public.append_case_timeline_event(uuid, text, text, text, jsonb)', 'authenticated'),
      ('public.create_receipt_voucher(uuid)', 'authenticated'),
      ('public.reprint_receipt_voucher(uuid)', 'authenticated'),
      ('public.list_firm_audit_logs(integer)', 'authenticated'),
      ('public.list_firm_activity_logs(integer, text, timestamptz, timestamptz, text)', 'authenticated'),
      ('public.list_firm_activity_logs(integer, text)', 'authenticated'),
      ('public.get_financial_report()', 'authenticated'),
      ('public.get_outstanding_balances_report()', 'authenticated'),
      ('public.get_payments_report(date, date)', 'authenticated'),
      ('public.get_session_report(date, date)', 'authenticated'),
      ('public.list_pending_member_registrations()', 'authenticated'),
      ('public.approve_member_registration(uuid)', 'authenticated'),
      ('public.reject_member_registration(uuid)', 'authenticated'),
      ('public.get_employee_permissions(uuid)', 'authenticated'),
      ('public.update_employee_permissions(uuid, jsonb)', 'authenticated'),
      ('public.apply_firm_role_to_employee(uuid, uuid)', 'authenticated'),
      ('public.update_firm_role_permissions(uuid, jsonb)', 'authenticated'),
      ('public.create_custom_firm_role(text, text, jsonb)', 'authenticated'),
      ('public.get_my_permissions()', 'authenticated'),
      ('public.get_my_role_label()', 'authenticated'),
      ('public.list_firm_security_events(integer)', 'authenticated'),
      ('public.submit_client_error_log(text, text, jsonb, text)', 'authenticated'),
      ('public.assert_ai_assistant_access()', 'authenticated'),
      ('public.get_firm_document_encryption_key()', 'authenticated'),
      ('public.register_firm_backup(bigint, integer, text[], text)', 'authenticated'),
      ('public.register_firm_export(text, text, jsonb, integer)', 'authenticated'),
      ('public.list_firm_backups(integer)', 'authenticated'),
      ('public.get_firm_security_stats()', 'authenticated'),
      ('public.is_email_available_for_registration(text)', 'authenticated, service_role')
    ) as grants(function_signature, grantees)
  loop
    begin
      execute format(
        'grant execute on function %s to %s',
        grant_row.function_signature,
        grant_row.grantees
      );
    exception
      when undefined_function then
        raise notice 'Skipped missing function: %', grant_row.function_signature;
    end;
  end loop;
end $$;

-- ─── 8) Private helpers referenced in RLS (authenticated must EXECUTE) ───────
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'private.get_current_firm_id()',
    'private.get_current_employee_id()',
    'private.get_current_profile_role()',
    'private.get_current_role()',
    'private.get_current_lawyer_id()',
    'private.is_office_profile_admin()',
    'private.is_office_admin()',
    'private.is_firm_manager()',
    'private.is_current_user_office_admin()',
    'private.is_firm_subscription_active()',
    'private.can_access_case(uuid)',
    'private.can_delete_clients()',
    'private.can_delete_execution_requests()',
    'private.storage_case_id(text)',
    'private.is_platform_operator()',
    'private.is_billing_admin()',
    'private.is_subscription_super_admin()',
    'private.has_permission(text)',
    'private.employee_effective_permissions(uuid)',
    'private.can_view_case_financials(uuid)',
    'private.can_manage_case_financials(uuid)'
  ]
  loop
    begin
      execute format('grant execute on function %s to authenticated, service_role', sig);
    exception when undefined_function then
      raise notice 'Skipped private helper: %', sig;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
