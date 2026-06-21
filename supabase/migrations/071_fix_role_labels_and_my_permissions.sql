-- Arabic role labels + reliable permission fetch for current user

update public.firm_roles
set name = 'محامٍ أول'
where slug = 'managing_lawyer'
  and name ilike '%managing%';

create or replace function public.seed_firm_role_templates(p_firm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.firm_roles (firm_id, name, slug, is_template, permissions)
  values
    (p_firm_id, 'مالك المكتب', 'firm_owner', true, '{
      "cases.view":true,"cases.create":true,"cases.edit":true,"cases.delete":true,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":true,
      "documents.upload":true,"documents.download":true,"documents.delete":true,
      "financials.view":true,"financials.add_payments":true,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":true,"users.manage":true,"users.permissions":true,
      "subscriptions.view":true,"subscriptions.manage":true,
      "settings.view":true,"settings.edit":true
    }'::jsonb),
    (p_firm_id, 'محامٍ أول', 'managing_lawyer', true, '{
      "cases.view":true,"cases.create":true,"cases.edit":true,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":true,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":true,"users.manage":false,"users.permissions":false,
      "subscriptions.view":true,"subscriptions.manage":false,
      "settings.view":true,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'محامٍ', 'lawyer', true, '{
      "cases.view":true,"cases.create":true,"cases.edit":true,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":false,"financials.print_receipts":false,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":false,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'مساعد قانوني', 'legal_assistant', true, '{
      "cases.view":true,"cases.create":false,"cases.edit":false,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":false,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":true,"sessions.edit":true,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":false,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'محاسب', 'accountant', true, '{
      "cases.view":true,"cases.create":false,"cases.edit":false,"cases.delete":false,
      "clients.view":true,"clients.create":false,"clients.edit":false,"clients.delete":false,
      "documents.upload":false,"documents.download":true,"documents.delete":false,
      "financials.view":true,"financials.add_payments":true,"financials.print_receipts":true,
      "sessions.view":true,"sessions.create":false,"sessions.edit":false,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":true,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb),
    (p_firm_id, 'سكرتير', 'secretary', true, '{
      "cases.view":true,"cases.create":false,"cases.edit":false,"cases.delete":false,
      "clients.view":true,"clients.create":true,"clients.edit":true,"clients.delete":false,
      "documents.upload":true,"documents.download":true,"documents.delete":false,
      "financials.view":false,"financials.add_payments":false,"financials.print_receipts":false,
      "sessions.view":true,"sessions.create":true,"sessions.edit":false,
      "users.invite":false,"users.manage":false,"users.permissions":false,
      "subscriptions.view":false,"subscriptions.manage":false,
      "settings.view":false,"settings.edit":false
    }'::jsonb)
  on conflict (firm_id, slug) do nothing;
end;
$$;

create or replace function public.get_my_permissions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_employee_id uuid;
begin
  if auth.uid() is null then
    return '{}'::jsonb;
  end if;

  select e.id into v_employee_id
  from public.employees e
  where e.auth_uid = auth.uid()
    and e.deleted_at is null
    and e.status = 'active'
  order by e.created_at desc
  limit 1;

  if v_employee_id is null then
    return '{}'::jsonb;
  end if;

  return coalesce(private.employee_effective_permissions(v_employee_id), '{}'::jsonb);
end;
$$;

create or replace function public.get_my_role_label()
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    nullif(trim(fr.name), ''),
    case e.role::text
      when 'super_admin' then 'مدير المنصة'
      when 'firm_manager' then 'مالك المكتب'
      when 'admin' then 'مدير'
      when 'lawyer' then 'محامٍ'
      when 'assistant' then 'مساعد'
      else 'عضو'
    end
  )
  from public.employees e
  left join public.firm_roles fr on fr.id = e.firm_role_id
  where e.auth_uid = auth.uid()
    and e.deleted_at is null
  order by e.created_at desc
  limit 1;
$$;

grant execute on function public.get_my_role_label() to authenticated;

revoke all on function public.get_my_permissions() from public;
grant execute on function public.get_my_permissions() to authenticated;

-- Ensure employees with firm_role_id have individual_permissions backfilled
update public.employees e
set individual_permissions = fr.permissions
from public.firm_roles fr
where e.firm_role_id = fr.id
  and e.deleted_at is null
  and (
    e.individual_permissions is null
    or e.individual_permissions = '{}'::jsonb
  );
