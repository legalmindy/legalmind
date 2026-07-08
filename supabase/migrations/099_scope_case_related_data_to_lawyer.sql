-- 099: Propagate "lawyer sees only assigned cases" to all case-related data
--
-- private.can_access_case() is the single gate used by the RLS policies of
-- sessions, documents, case_payments, case_timeline_events, case financials
-- and the case-documents storage bucket. Align its lawyer detection with the
-- cases policy from migration 098 so a lawyer can only reach the sessions,
-- documents, payments and timeline of cases assigned to them.
--
--   • office admin / manager / owner  → every case in the firm
--   • lawyer (role = 'lawyer' OR has a lawyers record) → only cases whose
--     assigned_lawyer_id equals their own lawyers.id
--   • assistant / other non-lawyer staff → firm's active cases (unchanged)

create or replace function private.can_access_case(target_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = target_case_id
      and c.firm_id = private.get_current_firm_id()
      and c.deleted_at is null
      and (
        private.is_office_admin()
        or (
          (
            private.get_current_role() = 'lawyer'
            or private.get_current_lawyer_id() is not null
          )
          and c.assigned_lawyer_id is not null
          and c.assigned_lawyer_id = private.get_current_lawyer_id()
        )
        or (
          private.get_current_role() = 'assistant'
          and private.get_current_lawyer_id() is null
        )
      )
  );
$$;

revoke all on function private.can_access_case(uuid) from public, anon;
grant execute on function private.can_access_case(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
