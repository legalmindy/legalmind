-- Fix: FOR UPDATE cannot be applied to the nullable side of an outer join
-- in approve_member_registration (LEFT JOIN firm_roles + FOR UPDATE).

create or replace function public.approve_member_registration(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
  v_employee public.employees%rowtype;
  v_role_slug text;
begin
  if not private.is_office_admin() then
    raise exception 'not_authorized';
  end if;

  v_firm_id := private.get_current_firm_id();

  select e.*
  into v_employee
  from public.employees e
  where e.id = p_employee_id
    and e.firm_id = v_firm_id
    and e.deleted_at is null
    and e.status = 'pending_approval'
  for update;

  if not found then
    raise exception 'member_not_pending';
  end if;

  select fr.slug
  into v_role_slug
  from public.firm_roles fr
  where fr.id = v_employee.firm_role_id;

  update public.employees
  set status = 'active', updated_at = now()
  where id = p_employee_id;

  if v_employee.role = 'lawyer'
     or coalesce(v_role_slug, '') in ('lawyer', 'managing_lawyer') then
    insert into public.lawyers(employee_id)
    values (p_employee_id)
    on conflict (employee_id) do nothing;
  end if;
end;
$$;

revoke all on function public.approve_member_registration(uuid) from public;
grant execute on function public.approve_member_registration(uuid) to authenticated;
