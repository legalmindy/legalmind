-- LegalMind Yemen — Security Advisor: authenticated DEFINER + RLS policy cleanup
-- Run after 082_anon_security_definer_fix.sql
--
-- Resolves:
--   • Signed-In Users Can Execute SECURITY DEFINER Function (lint 0033)
--   • Multiple Permissive Policies
--   • Auth RLS Initialization Plan (wrap auth.* / current_setting in SELECT)

-- ─── 0) Repair partial runs: trigger functions must stay plpgsql DEFINER ─────
do $$
declare
  bad_svc record;
begin
  for bad_svc in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname like '%\_svc' escape '\'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('drop function if exists %s cascade', bad_svc.signature);
  end loop;
end $$;

drop function if exists private.sync_lawyer_profile_svc();
drop function if exists private.create_office_member_profile_svc(uuid, text, text, text, text);
drop function if exists private.create_lawyer_profile_svc(uuid, text, text, text);

create or replace function public.sync_lawyer_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);

  if new.role = 'lawyer' and new.status = 'active' and new.deleted_at is null then
    insert into public.lawyers (employee_id)
    values (new.id)
    on conflict (employee_id) do nothing;
  elsif tg_op = 'UPDATE' and old.role = 'lawyer' and new.role <> 'lawyer' then
    delete from public.lawyers where employee_id = new.id;
  end if;

  return new;
end;
$$;

-- ─── 1) Elevated RPCs → private.*_svc (DEFINER) + public INVOKER wrappers ───
-- Only client-callable routines (skip service_role-only provisioning helpers).
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
        'create_office_member_profile',
        'create_lawyer_profile',
        'repair_all_orphan_auth_profiles',
        'purge_old_audit_logs',
        'purge_old_error_logs',
        'purge_old_invitations',
        'expire_stale_firm_subscriptions',
        'expire_stale_subscriptions',
        'seed_firm_role_templates',
        'secure_random_bytes',
        'normalize_yemeni_phone_for_storage',
        'sanitize_employee_phone',
        'handle_new_user',
        'expire_old_invitations',
        'next_receipt_number',
        'sync_case_paid_amount_from_payments',
        'sync_lawyer_profile'
      )
      and (
        pg_get_functiondef(p.oid) ~* 'row_security'
        or pg_get_functiondef(p.oid) ~ 'auth\.users'
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

    svc_def := replace(
      r.def,
      'CREATE OR REPLACE FUNCTION public.' || r.proname || '(',
      'CREATE OR REPLACE FUNCTION private.' || r.proname || '_svc('
    );
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
      set search_path = public, private
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

-- ─── 2) Remaining public SECURITY DEFINER client RPCs → SECURITY INVOKER ───
do $$
declare
  r record;
  newdef text;
begin
  for r in
    select p.oid::regprocedure as sig, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and pg_get_functiondef(p.oid) !~* 'row_security'
      and pg_get_functiondef(p.oid) !~ 'auth\.users'
      and p.proname not in (
        'handle_new_user',
        'expire_old_invitations',
        'next_receipt_number',
        'sync_case_paid_amount_from_payments',
        'sync_lawyer_profile',
        'create_office_member_profile',
        'create_lawyer_profile',
        'repair_all_orphan_auth_profiles',
        'purge_old_audit_logs',
        'purge_old_error_logs',
        'purge_old_invitations',
        'expire_stale_firm_subscriptions',
        'expire_stale_subscriptions',
        'seed_firm_role_templates',
        'secure_random_bytes',
        'normalize_yemeni_phone_for_storage',
        'sanitize_employee_phone'
      )
  loop
    newdef := regexp_replace(r.def, '\msecurity\s+definer\M', 'security invoker', 'gi');
    if newdef is distinct from r.def then
      begin
        execute newdef;
      exception when others then
        raise notice 'invoker convert skip %: %', r.sig, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- ─── 3) Thin INVOKER wrappers for role-check RPCs (already private-backed) ───
create or replace function public.is_billing_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$ select private.is_billing_admin(); $$;

create or replace function public.is_subscription_super_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$ select private.is_subscription_super_admin(); $$;

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$ select private.is_platform_operator(); $$;

-- ─── 4) Consolidate duplicate permissive RLS policies ───────────────────────

-- employees: drop redundant own-row policy (already covered by employees_select)
drop policy if exists "employees_select_own_auth" on public.employees;

-- subscription_requests: drop duplicate super-admin SELECT + legacy INSERT
drop policy if exists "subscription_requests_select_super_admin" on public.subscription_requests;
drop policy if exists "subscription_requests_insert_firm" on public.subscription_requests;

drop policy if exists "subscription_requests_select" on public.subscription_requests;
create policy "subscription_requests_select" on public.subscription_requests
  for select
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    or (select private.is_billing_admin())
  );

-- firms: one SELECT for members + billing admin; narrow anon read for registration
drop policy if exists "firms_select" on public.firms;
drop policy if exists "firms_select_billing_admin" on public.firms;
drop policy if exists "firms_select_registration" on public.firms;

create policy "firms_select" on public.firms
  for select
  to authenticated
  using (
    id in (
      select firm_id from public.profiles
      where id = (select auth.uid()) and deleted_at is null
      union
      select firm_id from public.employees
      where auth_uid = (select auth.uid()) and deleted_at is null
    )
    or (select private.is_billing_admin())
  );

create policy "firms_select_registration" on public.firms
  for select
  to anon
  using (deleted_at is null and firm_code is not null);

-- invitations: split by role to avoid multiple permissive SELECT
drop policy if exists "invitations_select" on public.invitations;
drop policy if exists invitations_anon_preview_by_token on public.invitations;

create policy invitations_select_authenticated on public.invitations
  for select
  to authenticated
  using (
    (
      firm_id = (select private.get_current_firm_id())
      and (select private.is_firm_manager())
    )
    or (
      status = 'pending'
      and expires_at > now()
      and token_hash = encode(
        extensions.digest(
          nullif(trim(current_setting('app.invitation_token', true)), ''),
          'sha256'
        ),
        'hex'
      )
    )
  );

create policy invitations_select_anon on public.invitations
  for select
  to anon
  using (
    status = 'pending'
    and expires_at > now()
    and token_hash = encode(
      extensions.digest(
        nullif(trim(current_setting('app.invitation_token', true)), ''),
        'sha256'
      ),
      'hex'
    )
  );

-- firm_roles: split anon vs authenticated SELECT
drop policy if exists "firm_roles_select" on public.firm_roles;
drop policy if exists firm_roles_anon_registration_read on public.firm_roles;
drop policy if exists firm_roles_invitation_preview on public.firm_roles;

create policy firm_roles_select_authenticated on public.firm_roles
  for select
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    or (
      is_template = true
      and slug <> 'firm_owner'
      and exists (
        select 1 from public.firms_registration_public f
        where f.id = firm_roles.firm_id
      )
    )
    or exists (
      select 1
      from public.invitations i
      where i.firm_role_id = firm_roles.id
        and i.status = 'pending'
        and i.expires_at > now()
        and i.token_hash = encode(
          extensions.digest(
            nullif(trim(current_setting('app.invitation_token', true)), ''),
            'sha256'
          ),
          'hex'
        )
    )
  );

create policy firm_roles_select_anon on public.firm_roles
  for select
  to anon
  using (
    (
      is_template = true
      and slug <> 'firm_owner'
      and exists (
        select 1 from public.firms_registration_public f
        where f.id = firm_roles.firm_id
      )
    )
    or exists (
      select 1
      from public.invitations i
      where i.firm_role_id = firm_roles.id
        and i.status = 'pending'
        and i.expires_at > now()
        and i.token_hash = encode(
          extensions.digest(
            nullif(trim(current_setting('app.invitation_token', true)), ''),
            'sha256'
          ),
          'hex'
        )
    )
  );

-- firm_roles_manage was FOR ALL (duplicate SELECT); scope to mutations only
drop policy if exists "firm_roles_manage" on public.firm_roles;

create policy firm_roles_manage_insert on public.firm_roles
  for insert
  to authenticated
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select private.has_permission('users.permissions'))
  );

create policy firm_roles_manage_update on public.firm_roles
  for update
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.has_permission('users.permissions'))
  )
  with check (
    firm_id = (select private.get_current_firm_id())
    and (select private.has_permission('users.permissions'))
  );

create policy firm_roles_manage_delete on public.firm_roles
  for delete
  to authenticated
  using (
    firm_id = (select private.get_current_firm_id())
    and (select private.has_permission('users.permissions'))
  );

-- public_testimonials: separate SELECT from super-admin writes; split INSERT by role
drop policy if exists public_testimonials_select_approved on public.public_testimonials;
drop policy if exists public_testimonials_super_admin_all on public.public_testimonials;
drop policy if exists public_testimonials_insert_public on public.public_testimonials;

create policy public_testimonials_select on public.public_testimonials
  for select
  to anon, authenticated
  using (
    status = 'approved'
    or (select private.is_subscription_super_admin())
  );

create policy public_testimonials_insert_anon on public.public_testimonials
  for insert
  to anon
  with check (
    status = 'approved'
    and char_length(trim(author_name)) >= 2
    and char_length(trim(author_role)) >= 2
    and char_length(trim(body)) between 10 and 600
    and stars between 1 and 5
  );

create policy public_testimonials_insert_authenticated on public.public_testimonials
  for insert
  to authenticated
  with check (
    (select private.is_subscription_super_admin())
    or (
      status = 'approved'
      and char_length(trim(author_name)) >= 2
      and char_length(trim(author_role)) >= 2
      and char_length(trim(body)) between 10 and 600
      and stars between 1 and 5
    )
  );

create policy public_testimonials_super_admin_update on public.public_testimonials
  for update
  to authenticated
  using ((select private.is_subscription_super_admin()))
  with check ((select private.is_subscription_super_admin()));

create policy public_testimonials_super_admin_delete on public.public_testimonials
  for delete
  to authenticated
  using ((select private.is_subscription_super_admin()));

-- ─── 5) Auth RLS initplan: wrap volatile auth calls in SELECT subqueries ──────
drop policy if exists security_events_insert_anon on public.security_events;
create policy security_events_insert_anon on public.security_events
  for insert
  to anon
  with check (
    actor_auth_uid is null
    and firm_id is null
    and employee_id is null
    and severity in ('info', 'warning', 'high', 'critical')
  );

drop policy if exists security_events_insert_authenticated on public.security_events;
create policy security_events_insert_authenticated on public.security_events
  for insert
  to authenticated
  with check (
    actor_auth_uid is null or actor_auth_uid = (select auth.uid())
  );

-- ─── 6) Final sweep: no client execute on public SECURITY DEFINER ───────────
-- Trigger/internal DEFINER routines stay DEFINER but are not client-callable.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.proname
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

-- ─── 7) Re-assert authenticated / anon grants (public INVOKER RPCs only) ───
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
