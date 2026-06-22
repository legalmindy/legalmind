-- Allow accountants (financials.* permissions) to view/add office expenses on reports page.

drop policy if exists "expenses_select" on public.office_expenses;
create policy "expenses_select" on public.office_expenses for select
  using (
    (select private.is_firm_subscription_active())
    and firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (
      (select private.is_office_admin())
      or (select private.has_permission('financials.view'))
    )
  );

drop policy if exists "expenses_insert" on public.office_expenses;
create policy "expenses_insert" on public.office_expenses for insert
  with check (
    firm_id = (select private.get_current_firm_id())
    and (
      (select private.is_office_admin())
      or (select private.has_permission('financials.add_payments'))
    )
  );

drop policy if exists "expenses_update" on public.office_expenses;
create policy "expenses_update" on public.office_expenses for update
  using (
    firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (
      (select private.is_office_admin())
      or (select private.has_permission('financials.add_payments'))
    )
  )
  with check (
    firm_id = (select private.get_current_firm_id())
    and (
      (select private.is_office_admin())
      or (select private.has_permission('financials.add_payments'))
    )
  );

-- Sync accountant employees missing permission payload from their firm role template.
update public.employees e
set individual_permissions = fr.permissions
from public.firm_roles fr
where e.firm_role_id = fr.id
  and fr.slug = 'accountant'
  and e.deleted_at is null
  and e.status = 'active'
  and (
    e.individual_permissions is null
    or e.individual_permissions = '{}'::jsonb
  );
