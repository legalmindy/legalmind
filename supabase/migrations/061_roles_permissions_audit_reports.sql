-- Modules 6–8: Firm roles/permissions, audit enhancements, report RPCs

-- ─── Module 6: Roles & permission matrix ───────────────────────────────────────
create table if not exists public.firm_roles (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  name text not null,
  slug text not null,
  is_template boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, slug)
);

create index if not exists idx_firm_roles_firm on public.firm_roles (firm_id);

alter table public.employees
  add column if not exists firm_role_id uuid references public.firm_roles(id) on delete set null;

-- Seed default role templates for every firm
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
    (p_firm_id, 'محامٍ managing', 'managing_lawyer', true, '{
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

-- Seed all existing firms
do $$
declare r record;
begin
  for r in select id from public.firms where deleted_at is null loop
    perform public.seed_firm_role_templates(r.id);
  end loop;
end $$;

-- Map legacy employee roles to firm_role_id
update public.employees e
set firm_role_id = fr.id
from public.firm_roles fr
where fr.firm_id = e.firm_id
  and e.firm_role_id is null
  and (
    (e.role in ('super_admin','admin','firm_manager') and fr.slug = 'firm_owner')
    or (e.role = 'lawyer' and fr.slug = 'lawyer')
    or (e.role = 'assistant' and fr.slug = 'legal_assistant')
  );

-- Replace has_permission with firm_role aware version
create or replace function private.has_permission(perm_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = private, public
as $$
declare
  v_perm boolean;
  v_role text;
begin
  if perm_key is null or perm_key = '' then return false; end if;

  select (fr.permissions ->> perm_key)::boolean
  into v_perm
  from public.employees e
  join public.firm_roles fr on fr.id = e.firm_role_id
  where e.auth_uid = auth.uid()
    and e.deleted_at is null
    and e.status = 'active'
  limit 1;

  if v_perm is not null then return v_perm; end if;

  v_role := private.get_current_role()::text;
  return case perm_key
    when 'financials.view' then v_role in ('super_admin','admin','firm_manager','lawyer','assistant')
    when 'financials.add_payments' then v_role in ('super_admin','admin','firm_manager')
    else private.is_office_admin()
  end;
end;
$$;

alter table public.firm_roles enable row level security;

drop policy if exists "firm_roles_select" on public.firm_roles;
create policy "firm_roles_select" on public.firm_roles
  for select using (firm_id = private.get_current_firm_id());

drop policy if exists "firm_roles_manage" on public.firm_roles;
create policy "firm_roles_manage" on public.firm_roles
  for all using (
    firm_id = private.get_current_firm_id()
    and private.has_permission('users.permissions')
  );

grant select on public.firm_roles to authenticated;

-- ─── Module 7: Audit log enhancements ─────────────────────────────────────────
alter table public.audit_logs
  add column if not exists action_type text,
  add column if not exists entity_summary text;

create or replace function private.insert_audit_log()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
declare
  changes jsonb;
  emp_id uuid;
  v_ip inet;
begin
  emp_id := private.get_current_employee_id();
  if tg_op = 'INSERT' then changes := row_to_json(new)::jsonb;
  elsif tg_op = 'UPDATE' then changes := jsonb_build_object('old', row_to_json(old), 'new', row_to_json(new));
  elsif tg_op = 'DELETE' then changes := row_to_json(old)::jsonb;
  end if;

  begin
    v_ip := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for';
    if v_ip is not null and v_ip <> '' then
      v_ip := split_part(v_ip, ',', 1)::inet;
    else
      v_ip := null;
    end if;
  exception when others then
    v_ip := null;
  end;

  insert into public.audit_logs (
    table_name, record_id, operation, changed_by, changes, ip_address, action_type
  )
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    emp_id,
    changes,
    v_ip,
    tg_table_name || '.' || lower(tg_op)
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Audit on case_payments
drop trigger if exists audit_case_payments on public.case_payments;
create trigger audit_case_payments
  after insert or update or delete on public.case_payments
  for each row execute function private.insert_audit_log();

-- RPC: list audit logs for admins
create or replace function public.list_firm_audit_logs(p_limit integer default 100)
returns setof public.audit_logs
language sql
stable
security definer
set search_path = public, private
as $$
  select a.*
  from public.audit_logs a
  where private.is_office_admin()
    and (
      a.changed_by is null
      or exists (
        select 1 from public.employees e
        where e.id = a.changed_by
          and e.firm_id = private.get_current_firm_id()
      )
      or a.table_name in ('case_payments', 'receipt_vouchers', 'cases', 'sessions')
    )
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.list_firm_audit_logs(integer) from public;
grant execute on function public.list_firm_audit_logs(integer) to authenticated;

-- ─── Module 8: Report views & RPCs ─────────────────────────────────────────────
create or replace view public.v_case_financial_summary
with (security_invoker = true)
as
select
  c.firm_id,
  c.id as case_id,
  c.title,
  c.court_case_number,
  cl.name as client_name,
  c.contract_currency,
  c.contract_date,
  c.total_amount as contract_total,
  c.paid_amount as total_paid,
  c.remaining_amount,
  case when c.total_amount > 0
    then round((c.paid_amount / c.total_amount) * 100, 2)
    else 0
  end as payment_percentage,
  (
    select max(cp.payment_date)
    from public.case_payments cp
    where cp.case_id = c.id and cp.deleted_at is null
  ) as last_payment_date,
  (
    select cp.amount
    from public.case_payments cp
    where cp.case_id = c.id and cp.deleted_at is null
    order by cp.payment_date desc, cp.created_at desc
    limit 1
  ) as last_payment_amount
from public.cases c
join public.clients cl on cl.id = c.client_id
where c.deleted_at is null;

create or replace function public.get_financial_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_firm uuid := private.get_current_firm_id();
begin
  if not private.is_office_admin() and not private.has_permission('financials.view') then
    raise exception 'not_authorized';
  end if;

  return jsonb_build_object(
    'total_contracts', (select coalesce(sum(total_amount),0) from public.cases where firm_id=v_firm and deleted_at is null),
    'total_collected', (select coalesce(sum(paid_amount),0) from public.cases where firm_id=v_firm and deleted_at is null),
    'total_outstanding', (select coalesce(sum(remaining_amount),0) from public.cases where firm_id=v_firm and deleted_at is null),
    'payments_count', (select count(*) from public.case_payments where firm_id=v_firm and deleted_at is null),
    'cases', (
      select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb)
      from public.v_case_financial_summary v
      where v.firm_id = v_firm
    )
  );
end;
$$;

create or replace function public.get_outstanding_balances_report()
returns setof public.v_case_financial_summary
language sql
stable
security definer
set search_path = public, private
as $$
  select *
  from public.v_case_financial_summary v
  where v.firm_id = private.get_current_firm_id()
    and v.remaining_amount > 0
    and (private.is_office_admin() or private.has_permission('financials.view'))
  order by v.remaining_amount desc;
$$;

create or replace function public.get_payments_report(p_from date default null, p_to date default null)
returns table (
  payment_id uuid,
  case_id uuid,
  case_title text,
  client_name text,
  amount numeric,
  payment_date date,
  payment_method text,
  notes text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    cp.id,
    cp.case_id,
    c.title,
    cl.name,
    cp.amount,
    cp.payment_date,
    cp.payment_method,
    cp.notes
  from public.case_payments cp
  join public.cases c on c.id = cp.case_id
  join public.clients cl on cl.id = c.client_id
  where cp.firm_id = private.get_current_firm_id()
    and cp.deleted_at is null
    and (private.is_office_admin() or private.has_permission('financials.view'))
    and (p_from is null or cp.payment_date >= p_from)
    and (p_to is null or cp.payment_date <= p_to)
  order by cp.payment_date desc;
$$;

create or replace function public.get_session_report(p_from date default null, p_to date default null)
returns table (
  session_id uuid,
  case_id uuid,
  case_title text,
  session_date date,
  court text,
  judge_name text,
  status text,
  session_type text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    s.id,
    s.case_id,
    c.title,
    s.session_date,
    s.court,
    s.judge_name,
    s.status,
    s.session_type
  from public.sessions s
  join public.cases c on c.id = s.case_id
  where s.firm_id = private.get_current_firm_id()
    and s.deleted_at is null
    and private.has_permission('sessions.view')
    and (p_from is null or s.session_date >= p_from)
    and (p_to is null or s.session_date <= p_to)
  order by s.session_date desc;
$$;

revoke all on function public.get_financial_report() from public;
grant execute on function public.get_financial_report() to authenticated;
revoke all on function public.get_outstanding_balances_report() from public;
grant execute on function public.get_outstanding_balances_report() to authenticated;
revoke all on function public.get_payments_report(date, date) from public;
grant execute on function public.get_payments_report(date, date) to authenticated;
revoke all on function public.get_session_report(date, date) from public;
grant execute on function public.get_session_report(date, date) to authenticated;

grant select on public.v_case_financial_summary to authenticated;
