-- Lawyer case visibility + RLS role resolution fix
-- Ensures assigned lawyers see their cases and get_current_lawyer_id() resolves reliably.

-- ─── 1) Backfill missing lawyers rows ─────────────────────────────────────────
insert into lawyers (employee_id)
select e.id
from employees e
where e.role = 'lawyer'
  and e.status = 'active'
  and e.deleted_at is null
  and not exists (select 1 from lawyers l where l.employee_id = e.id)
on conflict (employee_id) do nothing;

-- ─── 2) Resolve role even when profiles ↔ employees link is incomplete ────────
create or replace function get_current_role()
returns employee_role_enum
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select e.role
      from profiles p
      join employees e on e.id = p.employee_id and e.deleted_at is null
      where p.id = auth.uid() and p.deleted_at is null
      limit 1
    ),
    (
      select e.role
      from employees e
      where e.auth_uid = auth.uid() and e.deleted_at is null
      limit 1
    ),
    (
      select case p.role::text
        when 'lawyer' then 'lawyer'::employee_role_enum
        when 'assistant' then 'assistant'::employee_role_enum
        when 'admin' then 'firm_manager'::employee_role_enum
        else null::employee_role_enum
      end
      from profiles p
      where p.id = auth.uid() and p.deleted_at is null
      limit 1
    )
  );
$$;

-- ─── 3) Resolve lawyer id via employee (more reliable than auth_uid join) ────
create or replace function get_current_lawyer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from lawyers l
  where l.employee_id = get_current_employee_id()
  limit 1;
$$;

-- ─── 4) Refresh case access policies ─────────────────────────────────────────
drop policy if exists "cases_select_role_scoped" on cases;
create policy "cases_select_role_scoped" on cases for select
  using (
    firm_id = get_current_firm_id()
    and deleted_at is null
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (
        get_current_role() = 'lawyer'
        and assigned_lawyer_id is not null
        and assigned_lawyer_id = get_current_lawyer_id()
      )
    )
  );

drop policy if exists "cases_update_role_scoped" on cases;
create policy "cases_update_role_scoped" on cases for update
  using (
    firm_id = get_current_firm_id()
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (
        get_current_role() = 'lawyer'
        and assigned_lawyer_id is not null
        and assigned_lawyer_id = get_current_lawyer_id()
      )
    )
  )
  with check (
    firm_id = get_current_firm_id()
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (
        get_current_role() = 'lawyer'
        and assigned_lawyer_id is not null
        and assigned_lawyer_id = get_current_lawyer_id()
      )
    )
  );

grant execute on function public.get_current_lawyer_id() to authenticated;
grant execute on function public.get_current_role() to authenticated;
