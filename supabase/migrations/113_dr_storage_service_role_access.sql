-- DR Storage backup: allow service_role to read/write storage without hitting
-- tenant helper functions that authenticated policies call.
-- Non-destructive: GRANT + permissive policy for service_role only.
-- Does not alter application data or tighten/loosen end-user policies.

-- 1) Helper EXECUTE grants used inside storage policies
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
        'can_access_case'
      )
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

-- 2) Explicit service_role bypass policies on storage.objects / buckets
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
