-- Fix Storage RLS so service_role DR backups are not blocked by tenant policies.
-- Root cause: some storage.objects policies were created without TO authenticated,
-- so PostgreSQL evaluates them for service_role too. Expressions call
-- private.is_firm_subscription_active(); without EXECUTE/USAGE that throws and
-- aborts the whole Storage download even when a permissive service_role policy exists.
-- Non-destructive: GRANT + recreate policies scoped to authenticated only.

grant usage on schema private to service_role, authenticated, anon;

do $$
declare
  r record;
begin
  for r in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'is_firm_subscription_active',
        'get_current_firm_id',
        'get_current_role',
        'is_office_admin',
        'is_firm_manager',
        'is_platform_operator',
        'is_billing_admin',
        'can_access_case',
        'can_view_case_financials',
        'can_manage_case_financials',
        'storage_case_id'
      )
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

-- Scope payment-receipt policies to authenticated (were PUBLIC / all roles)
drop policy if exists "case_payment_receipts_select" on storage.objects;
create policy "case_payment_receipts_select" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'case-payment-receipts'
    and private.is_firm_subscription_active()
    and private.can_access_case(private.storage_case_id(name))
    and private.can_view_case_financials(private.storage_case_id(name))
  );

drop policy if exists "case_payment_receipts_insert" on storage.objects;
create policy "case_payment_receipts_insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'case-payment-receipts'
    and private.is_firm_subscription_active()
    and private.can_manage_case_financials(private.storage_case_id(name))
  );

drop policy if exists "case_payment_receipts_delete" on storage.objects;
create policy "case_payment_receipts_delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'case-payment-receipts'
    and private.can_manage_case_financials(private.storage_case_id(name))
  );

-- Keep explicit DR bypass for service_role
drop policy if exists "dr_service_role_objects_all" on storage.objects;
create policy "dr_service_role_objects_all" on storage.objects
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "dr_service_role_buckets_all" on storage.buckets;
create policy "dr_service_role_buckets_all" on storage.buckets
  for all
  to service_role
  using (true)
  with check (true);
