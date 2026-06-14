-- Fix get_current_profile_role return type mismatch when profiles.role uses employee_role_enum

drop function if exists is_office_profile_admin();
drop function if exists get_current_profile_role();

create or replace function get_current_profile_role()
returns text as $$
  select case role::text
    when 'firm_manager' then 'admin'
    when 'super_admin' then 'admin'
    else role::text
  end
  from profiles
  where id = auth.uid() and deleted_at is null
  limit 1;
$$ language sql stable security definer;

create or replace function is_office_profile_admin()
returns boolean as $$
  select coalesce(get_current_profile_role() = 'admin', false);
$$ language sql stable security definer;
