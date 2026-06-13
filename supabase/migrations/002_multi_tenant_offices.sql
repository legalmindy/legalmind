-- LegalMind Yemen — Multi-Tenant Office Hardening
-- Keeps firms/firm_id as the tenant boundary for the multi-tenant app.

create extension if not exists "pgcrypto";

-- ─── Invitations ──────────────────────────────────────────────
create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  email text not null check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  full_name text,
  phone text,
  role employee_role_enum not null check (role in ('admin','lawyer','assistant')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  token_hash text not null unique,
  invited_by uuid references employees(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_invitations_pending_email
  on invitations(firm_id, lower(email))
  where status = 'pending';
create index if not exists idx_invitations_firm_status on invitations(firm_id, status);
create index if not exists idx_invitations_token_hash on invitations(token_hash);
create index if not exists idx_invitations_expires_at on invitations(expires_at);
create index if not exists idx_employees_firm_auth_uid on employees(firm_id, auth_uid);
create index if not exists idx_employees_firm_role on employees(firm_id, role);
create index if not exists idx_cases_firm_assigned_lawyer on cases(firm_id, assigned_lawyer_id);
create index if not exists idx_sessions_case_deleted on sessions(case_id, deleted_at);
create index if not exists idx_documents_case_deleted on documents(case_id, deleted_at);
create index if not exists idx_case_attachments_case_deleted on case_attachments(case_id, deleted_at);

drop trigger if exists set_updated_at_invitations on invitations;
create trigger set_updated_at_invitations
  before update on invitations
  for each row execute function set_updated_at();

alter table invitations enable row level security;

-- ─── Role helpers ─────────────────────────────────────────────
create or replace function is_office_admin()
returns boolean as $$
  select coalesce(get_current_role() in ('super_admin','admin','firm_manager'), false);
$$ language sql stable security definer;

create or replace function get_current_lawyer_id()
returns uuid as $$
  select l.id
  from lawyers l
  join employees e on e.id = l.employee_id
  where e.auth_uid = auth.uid()
    and e.status = 'active'
    and e.deleted_at is null
  limit 1;
$$ language sql stable security definer;

create or replace function can_access_case(target_case_id uuid)
returns boolean as $$
  select exists (
    select 1
    from cases c
    where c.id = target_case_id
      and c.firm_id = get_current_firm_id()
      and c.deleted_at is null
      and (
        is_office_admin()
        or get_current_role() = 'assistant'
        or (get_current_role() = 'lawyer' and c.assigned_lawyer_id = get_current_lawyer_id())
      )
  );
$$ language sql stable security definer;

create or replace function invitation_hash(raw_token text)
returns text as $$
  select encode(digest(raw_token, 'sha256'), 'hex');
$$ language sql immutable security definer;

create or replace function get_invitation_by_token(raw_token text)
returns table (
  id uuid,
  firm_id uuid,
  firm_name text,
  email text,
  full_name text,
  phone text,
  role employee_role_enum,
  status text,
  expires_at timestamptz
) as $$
begin
  return query
  select i.id, i.firm_id, f.name, i.email, i.full_name, i.phone, i.role, i.status, i.expires_at
  from invitations i
  join firms f on f.id = i.firm_id
  where i.token_hash = invitation_hash(raw_token)
  limit 1;
end;
$$ language plpgsql stable security definer;

create or replace function accept_invitation_for_auth_user(raw_token text)
returns uuid as $$
declare
  inv invitations%rowtype;
  target_employee_id uuid;
  auth_email text;
begin
  auth_email := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
  if auth_email = '' then
    raise exception 'Authenticated user is required';
  end if;

  select * into inv
  from invitations
  where token_hash = invitation_hash(raw_token)
  for update;

  if not found or inv.status <> 'pending' or inv.expires_at <= now() then
    raise exception 'Invitation is invalid or expired';
  end if;

  if lower(inv.email) <> auth_email then
    raise exception 'Invitation email does not match current user';
  end if;

  select id into target_employee_id
  from employees
  where lower(email) = lower(inv.email)
    and firm_id = inv.firm_id
    and deleted_at is null
  limit 1;

  if target_employee_id is null then
    insert into employees (auth_uid, firm_id, full_name, email, phone, role, status)
    values (
      auth.uid(),
      inv.firm_id,
      coalesce(inv.full_name, split_part(inv.email, '@', 1)),
      inv.email,
      inv.phone,
      inv.role,
      'active'
    )
    returning id into target_employee_id;
  else
    update employees
    set auth_uid = auth.uid(),
        full_name = coalesce(inv.full_name, full_name),
        phone = coalesce(inv.phone, phone),
        role = inv.role,
        status = 'active',
        deleted_at = null
    where id = target_employee_id;
  end if;

  update invitations
  set status = 'accepted',
      accepted_at = now(),
      employee_id = target_employee_id
  where id = inv.id;

  return target_employee_id;
end;
$$ language plpgsql security definer;

-- ─── Invitation-aware signup provisioning ─────────────────────
create or replace function handle_new_user()
returns trigger as $$
declare
  new_firm_id uuid;
  target_employee_id uuid;
  meta jsonb;
  raw_token text;
  inv invitations%rowtype;
begin
  meta := new.raw_user_meta_data;
  raw_token := nullif(meta->>'invitation_token', '');

  if raw_token is not null then
    select * into inv
    from invitations
    where token_hash = invitation_hash(raw_token)
      and status = 'pending'
      and expires_at > now()
      and lower(email) = lower(new.email)
    for update;

    if found then
      select id into target_employee_id
      from employees
      where firm_id = inv.firm_id
        and lower(email) = lower(inv.email)
        and deleted_at is null
      limit 1;

      if target_employee_id is null then
        insert into employees (auth_uid, firm_id, full_name, email, phone, role, status)
        values (
          new.id,
          inv.firm_id,
          coalesce(inv.full_name, meta->>'full_name', split_part(new.email, '@', 1)),
          new.email,
          inv.phone,
          inv.role,
          'active'
        )
        returning id into target_employee_id;
      else
        update employees
        set auth_uid = new.id,
            full_name = coalesce(inv.full_name, employees.full_name),
            phone = coalesce(inv.phone, employees.phone),
            role = inv.role,
            status = 'active',
            deleted_at = null
        where id = target_employee_id;
      end if;

      update invitations
      set status = 'accepted',
          accepted_at = now(),
          employee_id = target_employee_id
      where id = inv.id;

      return new;
    end if;
  end if;

  insert into firms (name, plan)
  values (coalesce(meta->>'company', 'مكتب جديد'), 'free')
  returning id into new_firm_id;

  insert into employees (auth_uid, firm_id, full_name, email, role, status)
  values (
    new.id,
    new_firm_id,
    coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((meta->>'role')::employee_role_enum, 'firm_manager'),
    'active'
  );

  return new;
end;
$$ language plpgsql security definer;

-- ─── Lawyer provisioning and assignment safeguards ────────────
create or replace function sync_lawyer_profile()
returns trigger as $$
begin
  if new.role = 'lawyer' and new.status = 'active' and new.deleted_at is null then
    insert into lawyers (employee_id)
    values (new.id)
    on conflict (employee_id) do nothing;
  elsif old.role = 'lawyer' and new.role <> 'lawyer' then
    delete from lawyers where employee_id = new.id;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_sync_lawyer_profile on employees;
create trigger trg_sync_lawyer_profile
  after insert or update of role, status, deleted_at on employees
  for each row execute function sync_lawyer_profile();

insert into lawyers (employee_id)
select id from employees
where role = 'lawyer'
  and status = 'active'
  and deleted_at is null
on conflict (employee_id) do nothing;

create or replace function validate_case_tenant_links()
returns trigger as $$
declare
  client_firm uuid;
  lawyer_firm uuid;
begin
  select firm_id into client_firm from clients where id = new.client_id and deleted_at is null;
  if client_firm is null or client_firm <> new.firm_id then
    raise exception 'Client must belong to the same office as the case';
  end if;

  if new.assigned_lawyer_id is not null then
    select e.firm_id into lawyer_firm
    from lawyers l
    join employees e on e.id = l.employee_id
    where l.id = new.assigned_lawyer_id
      and e.deleted_at is null
      and e.status = 'active';

    if lawyer_firm is null or lawyer_firm <> new.firm_id then
      raise exception 'Assigned lawyer must belong to the same office as the case';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_validate_case_tenant_links on cases;
create trigger trg_validate_case_tenant_links
  before insert or update of firm_id, client_id, assigned_lawyer_id on cases
  for each row execute function validate_case_tenant_links();

-- ─── Replace broad RLS policies with office-aware RBAC ────────
drop policy if exists "firms_select_own" on firms;
drop policy if exists "firms_update_admin" on firms;
drop policy if exists "employees_select_firm" on employees;
drop policy if exists "employees_insert_admin" on employees;
drop policy if exists "employees_update_admin" on employees;
drop policy if exists "employees_delete_admin" on employees;
drop policy if exists "clients_select_firm" on clients;
drop policy if exists "clients_insert_firm" on clients;
drop policy if exists "clients_update_firm" on clients;
drop policy if exists "clients_soft_delete_admin" on clients;
drop policy if exists "cases_select_firm" on cases;
drop policy if exists "cases_insert_firm" on cases;
drop policy if exists "cases_update_firm" on cases;
drop policy if exists "cases_delete_admin" on cases;
drop policy if exists "sessions_select_firm" on sessions;
drop policy if exists "sessions_insert_firm" on sessions;
drop policy if exists "sessions_update_firm" on sessions;
drop policy if exists "sessions_delete_firm" on sessions;
drop policy if exists "documents_select_firm" on documents;
drop policy if exists "documents_insert_firm" on documents;
drop policy if exists "documents_delete_admin" on documents;
drop policy if exists "attachments_select_firm" on case_attachments;
drop policy if exists "attachments_insert_firm" on case_attachments;
drop policy if exists "lawyers_select_firm" on lawyers;
drop policy if exists "lawyers_insert_admin" on lawyers;
drop policy if exists "notifications_select_own" on notifications;
drop policy if exists "notifications_update_own" on notifications;
drop policy if exists "notifications_insert_system" on notifications;
drop policy if exists "audit_logs_select_admin" on audit_logs;
drop policy if exists "error_logs_insert" on error_logs;
drop policy if exists "error_logs_select_admin" on error_logs;

create policy "firms_select_own" on firms for select
  using (id = get_current_firm_id());
create policy "firms_update_admin" on firms for update
  using (id = get_current_firm_id() and is_office_admin())
  with check (id = get_current_firm_id() and is_office_admin());

create policy "employees_select_office" on employees for select
  using (firm_id = get_current_firm_id() and deleted_at is null);
create policy "employees_insert_admin" on employees for insert
  with check (firm_id = get_current_firm_id() and is_office_admin());
create policy "employees_update_admin" on employees for update
  using (firm_id = get_current_firm_id() and is_office_admin())
  with check (firm_id = get_current_firm_id() and is_office_admin());
create policy "employees_delete_admin" on employees for delete
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin'));

create policy "clients_select_role_scoped" on clients for select
  using (
    firm_id = get_current_firm_id()
    and deleted_at is null
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or exists (
        select 1 from cases c
        where c.client_id = clients.id
          and c.deleted_at is null
          and c.assigned_lawyer_id = get_current_lawyer_id()
      )
    )
  );
create policy "clients_insert_staff" on clients for insert
  with check (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager','assistant'));
create policy "clients_update_staff" on clients for update
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager','assistant'))
  with check (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager','assistant'));

create policy "cases_select_role_scoped" on cases for select
  using (
    firm_id = get_current_firm_id()
    and deleted_at is null
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (get_current_role() = 'lawyer' and assigned_lawyer_id = get_current_lawyer_id())
    )
  );
create policy "cases_insert_staff" on cases for insert
  with check (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager','assistant'));
create policy "cases_update_role_scoped" on cases for update
  using (
    firm_id = get_current_firm_id()
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (get_current_role() = 'lawyer' and assigned_lawyer_id = get_current_lawyer_id())
    )
  )
  with check (
    firm_id = get_current_firm_id()
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (get_current_role() = 'lawyer' and assigned_lawyer_id = get_current_lawyer_id())
    )
  );
create policy "cases_delete_admin" on cases for delete
  using (firm_id = get_current_firm_id() and is_office_admin());

create policy "sessions_select_case_access" on sessions for select
  using (deleted_at is null and can_access_case(case_id));
create policy "sessions_insert_staff" on sessions for insert
  with check (can_access_case(case_id) and get_current_role() in ('super_admin','admin','firm_manager','assistant','lawyer'));
create policy "sessions_update_staff" on sessions for update
  using (can_access_case(case_id))
  with check (can_access_case(case_id));
create policy "sessions_delete_admin" on sessions for delete
  using (can_access_case(case_id) and is_office_admin());

create policy "documents_select_case_access" on documents for select
  using (deleted_at is null and can_access_case(case_id));
create policy "documents_insert_case_access" on documents for insert
  with check (can_access_case(case_id));
create policy "documents_update_case_access" on documents for update
  using (can_access_case(case_id))
  with check (can_access_case(case_id));
create policy "documents_delete_admin" on documents for delete
  using (can_access_case(case_id) and is_office_admin());

create policy "attachments_select_case_access" on case_attachments for select
  using (deleted_at is null and can_access_case(case_id));
create policy "attachments_insert_case_access" on case_attachments for insert
  with check (can_access_case(case_id));
create policy "attachments_update_case_access" on case_attachments for update
  using (can_access_case(case_id))
  with check (can_access_case(case_id));
create policy "attachments_delete_admin" on case_attachments for delete
  using (can_access_case(case_id) and is_office_admin());

create policy "lawyers_select_office" on lawyers for select
  using (exists (
    select 1 from employees e
    where e.id = lawyers.employee_id
      and e.firm_id = get_current_firm_id()
      and e.deleted_at is null
  ));
create policy "lawyers_insert_admin" on lawyers for insert
  with check (exists (
    select 1 from employees e
    where e.id = employee_id
      and e.firm_id = get_current_firm_id()
      and is_office_admin()
  ));
create policy "lawyers_update_admin" on lawyers for update
  using (exists (
    select 1 from employees e
    where e.id = lawyers.employee_id
      and e.firm_id = get_current_firm_id()
      and is_office_admin()
  ))
  with check (exists (
    select 1 from employees e
    where e.id = employee_id
      and e.firm_id = get_current_firm_id()
      and is_office_admin()
  ));

create policy "invitations_select_admin" on invitations for select
  using (firm_id = get_current_firm_id() and is_office_admin());
create policy "invitations_insert_admin" on invitations for insert
  with check (firm_id = get_current_firm_id() and is_office_admin());
create policy "invitations_update_admin" on invitations for update
  using (firm_id = get_current_firm_id() and is_office_admin())
  with check (firm_id = get_current_firm_id() and is_office_admin());

create policy "notifications_select_own" on notifications for select
  using (firm_id = get_current_firm_id() and (employee_id is null or employee_id = get_current_employee_id()));
create policy "notifications_update_own" on notifications for update
  using (firm_id = get_current_firm_id() and (employee_id is null or employee_id = get_current_employee_id()));
create policy "notifications_insert_staff" on notifications for insert
  with check (firm_id = get_current_firm_id());

create policy "audit_logs_select_admin" on audit_logs for select
  using (is_office_admin());

create policy "error_logs_insert" on error_logs for insert
  with check (auth.role() = 'authenticated');
create policy "error_logs_select_admin" on error_logs for select
  using (is_office_admin());

-- ─── Storage hardening ────────────────────────────────────────
drop policy if exists "storage_select_firm" on storage.objects;
drop policy if exists "storage_insert_firm" on storage.objects;
drop policy if exists "storage_delete_admin" on storage.objects;

create or replace function storage_case_id(object_name text)
returns uuid as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$ language sql immutable;

create policy "storage_select_case_access" on storage.objects for select
  using (bucket_id = 'case-documents' and can_access_case(storage_case_id(name)));
create policy "storage_insert_case_access" on storage.objects for insert
  with check (bucket_id = 'case-documents' and can_access_case(storage_case_id(name)));
create policy "storage_update_case_access" on storage.objects for update
  using (bucket_id = 'case-documents' and can_access_case(storage_case_id(name)))
  with check (bucket_id = 'case-documents' and can_access_case(storage_case_id(name)));
create policy "storage_delete_admin" on storage.objects for delete
  using (bucket_id = 'case-documents' and can_access_case(storage_case_id(name)) and is_office_admin());
