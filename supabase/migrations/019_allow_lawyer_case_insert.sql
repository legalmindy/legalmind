-- Allow lawyers to create cases assigned to themselves (UI already permits case management for lawyers).

drop policy if exists "cases_insert_staff" on cases;

create policy "cases_insert_staff" on cases for insert
  with check (
    firm_id = get_current_firm_id()
    and (
      get_current_role() in ('super_admin', 'admin', 'firm_manager', 'assistant')
      or (
        get_current_role() = 'lawyer'
        and (assigned_lawyer_id is null or assigned_lawyer_id = get_current_lawyer_id())
      )
    )
  );
