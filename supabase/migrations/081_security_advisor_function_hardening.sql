-- LegalMind Yemen — Security Advisor: fix all function search_path + PUBLIC execute warnings
-- Run after 080_public_testimonials.sql
--
-- Resolves:
--   • Function Search Path Mutable
--   • Public Can Execute SECURITY DEFINER Function
--
-- Dashboard (manual): Authentication → Password Security → Enable leaked password protection

-- ─── 1) Pin search_path on every public + private routine ────────────────────
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
        'alter function %s set search_path = %I, public',
        fn.signature,
        fn.schema_name
      );
    exception when others then
      raise notice 'search_path skip: %', fn.signature;
    end;
  end loop;
end $$;

-- ─── 2) Revoke default PUBLIC / role execute on all routines ───────────────
revoke all on all functions in schema public from public;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema public from authenticated;
revoke all on all functions in schema public from service_role;

revoke all on all functions in schema private from public;
revoke all on all functions in schema private from anon;
revoke all on all functions in schema private from authenticated;
revoke all on all functions in schema private from service_role;

-- ─── 3) Whitelist: public RPC execute grants ───────────────────────────────
do $$
declare
  grant_row record;
begin
  for grant_row in
    select *
    from (values
      -- Pre-auth / registration (anon + authenticated)
      ('public.get_office_by_code(text)', 'anon, authenticated'),
      ('public.get_office_by_firm_code(text)', 'anon, authenticated'),
      ('public.office_code_exists(text)', 'anon, authenticated'),
      ('public.get_invitation_by_token(text)', 'anon, authenticated'),
      ('public.is_email_available_for_registration(text)', 'anon, authenticated'),
      ('public.is_valid_firm_code_format(text)', 'anon, authenticated'),
      ('public.get_firm_roles_for_registration(text)', 'anon, authenticated'),
      ('public.get_platform_bank_details()', 'anon, authenticated'),
      ('public.invitation_hash(text)', 'anon, authenticated, service_role'),
      ('public.storage_case_id(text)', 'anon, authenticated'),
      ('public.log_security_event(text, text, jsonb, text)', 'anon, authenticated'),
      ('public.list_approved_testimonials(integer)', 'anon, authenticated'),
      ('public.submit_public_testimonial(text, text, text, integer)', 'anon, authenticated'),

      -- Authenticated business RPCs
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

      -- Service role only (cron / provisioning / maintenance)
      ('public.purge_old_audit_logs(integer)', 'service_role'),
      ('public.purge_old_error_logs(integer)', 'service_role'),
      ('public.purge_old_invitations(integer)', 'service_role'),
      ('public.expire_stale_firm_subscriptions()', 'service_role'),
      ('public.expire_stale_subscriptions()', 'service_role'),
      ('public.seed_firm_role_templates(uuid)', 'service_role'),
      ('public.create_office_member_profile(uuid, text, text, text, text)', 'service_role'),
      ('public.create_lawyer_profile(uuid, text, text, text)', 'service_role'),
      ('public.secure_random_bytes(integer)', 'service_role'),
      ('public.normalize_yemeni_phone_for_storage(text)', 'service_role'),
      ('public.sanitize_employee_phone(text)', 'service_role'),
      ('public.repair_all_orphan_auth_profiles()', 'service_role'),
      ('public.create_invited_profile(uuid, text, text, text)', 'service_role')
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
        raise notice 'Skipped missing public function: %', grant_row.function_signature;
    end;
  end loop;
end $$;

-- ─── 4) Private helpers: authenticated (RLS) + service_role only ─────────
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
    'private.storage_case_id(text)',
    'private.is_platform_operator()',
    'private.is_billing_admin()',
    'private.is_subscription_super_admin()',
    'private.has_permission(text)',
    'private.employee_effective_permissions(uuid)'
  ]
  loop
    begin
      execute format('grant execute on function %s to authenticated, service_role', sig);
    exception when undefined_function then
      raise notice 'Skipped private helper: %', sig;
    end;
  end loop;
end $$;

-- ─── 5) Trigger / internal routines: never client-callable ─────────────────
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'private.touch_expenses_updated_at()',
    'private.insert_audit_log()',
    'private.ensure_sync_table_allowed(text)',
    'private.guard_employee_privilege_columns()',
    'private.timeline_on_document()',
    'private.timeline_on_case_lawyer_change()',
    'private.timeline_on_case_payment()',
    'private.timeline_on_session()',
    'private.audit_resolve_firm_id(text, jsonb)',
    'private.audit_entity_summary(text, text, jsonb, jsonb)',
    'private.employee_role_from_firm_slug(text)',
    'private.upsert_profile_for_employee(uuid, public.employees, text, text)',
    'public.handle_new_user()',
    'public.sync_case_paid_amount_from_payments()',
    'public.next_receipt_number(uuid)',
    'public.expire_old_invitations()'
  ]
  loop
    begin
      execute format('revoke all on function %s from public', sig);
      execute format('revoke all on function %s from anon', sig);
      execute format('revoke all on function %s from authenticated', sig);
    exception when undefined_function then null;
    end;
  end loop;
end $$;
