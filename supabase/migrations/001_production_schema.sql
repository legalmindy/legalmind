-- LegalMind Yemen — Production Schema Migration
-- Run via Supabase SQL Editor or CLI

create extension if not exists "pgcrypto";

-- ─── ENUM types ───────────────────────────────────────────────
do $$ begin
  create type case_type_enum as enum ('مدنية','تجارية','أحوال شخصية','عمالية','مستعجلة','جنائية');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_stage_enum as enum ('ابتدائي مدني','ابتدائي شخصي','ابتدائي جنائي','استئناف','نقض');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_status_enum as enum ('active','archived','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employee_role_enum as enum ('super_admin','admin','lawyer','assistant','firm_manager');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employee_status_enum as enum ('active','suspended','disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type document_type_enum as enum ('pdf','docx','xlsx','jpg','png','webp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type_enum as enum ('session','document','case','system');
exception when duplicate_object then null; end $$;

-- ─── Firms (multi-tenant) ─────────────────────────────────────
create table if not exists firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_no text,
  plan text not null default 'free' check (plan in ('free','pro','enterprise')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Employees ────────────────────────────────────────────────
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid unique references auth.users(id) on delete cascade,
  firm_id uuid references firms(id) on delete cascade,
  full_name text not null check (char_length(full_name) >= 2),
  email text not null unique check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  phone text check (phone is null or phone ~ '^[0-9]{9,15}$'),
  role employee_role_enum not null default 'assistant',
  status employee_status_enum not null default 'active',
  profile_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_employees_auth_uid on employees(auth_uid);
create index if not exists idx_employees_firm_id on employees(firm_id);
create index if not exists idx_employees_role on employees(role);

-- ─── Lawyers ──────────────────────────────────────────────────
create table if not exists lawyers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references employees(id) on delete cascade,
  specialization text default 'عام',
  success_rate numeric(5,2) default 0.00 check (success_rate >= 0 and success_rate <= 100),
  attendance_rate numeric(5,2) default 0.00 check (attendance_rate >= 0 and attendance_rate <= 100),
  total_cases integer default 0 check (total_cases >= 0),
  won_cases integer default 0 check (won_cases >= 0),
  attended_sessions integer default 0 check (attended_sessions >= 0),
  missed_sessions integer default 0 check (missed_sessions >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Clients ──────────────────────────────────────────────────
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  name text not null check (char_length(name) >= 2),
  phone text check (phone is null or phone ~ '^[0-9]{9,15}$'),
  email text check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  address text,
  type text not null default 'فرد' check (type in ('فرد','شركة تجارية')),
  cases_count integer not null default 0 check (cases_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (firm_id, phone)
);

create index if not exists idx_clients_firm_id on clients(firm_id);
create index if not exists idx_clients_name on clients(name);
create index if not exists idx_clients_created_at on clients(created_at desc);

-- ─── Cases ────────────────────────────────────────────────────
create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  assigned_lawyer_id uuid references lawyers(id) on delete set null,
  court_case_number text not null,
  title text not null check (char_length(title) >= 2),
  case_type case_type_enum not null,
  case_stage case_stage_enum not null,
  category text not null default 'تجاري',
  court text not null default '',
  description text default '',
  total_amount numeric(12,2) default 0.00 check (total_amount >= 0),
  paid_amount numeric(12,2) default 0.00 check (paid_amount >= 0),
  remaining_amount numeric(12,2) generated always as (total_amount - paid_amount) stored,
  status case_status_enum not null default 'active',
  judgment_date date,
  archive_date date,
  closed_by uuid references employees(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (firm_id, court_case_number),
  check (paid_amount <= total_amount)
);

create index if not exists idx_cases_firm_id on cases(firm_id);
create index if not exists idx_cases_client_id on cases(client_id);
create index if not exists idx_cases_assigned_lawyer_id on cases(assigned_lawyer_id);
create index if not exists idx_cases_status on cases(status);
create index if not exists idx_cases_case_type on cases(case_type);
create index if not exists idx_cases_created_at on cases(created_at desc);

-- ─── Sessions ─────────────────────────────────────────────────
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  scheduled_by uuid references employees(id) on delete set null,
  court text not null,
  session_date date not null,
  session_time time not null,
  status text not null default 'مجدولة' check (status in ('مجدولة','منعقدة','مؤجلة','ملغاة')),
  session_type text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_sessions_case_id on sessions(case_id);
create index if not exists idx_sessions_session_date on sessions(session_date);
create index if not exists idx_sessions_status on sessions(status);

-- ─── Documents ────────────────────────────────────────────────
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete cascade,
  uploaded_by uuid references employees(id) on delete set null,
  title text not null,
  category text not null default 'مستند قانوني',
  file_type document_type_enum not null,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  storage_path text not null unique,
  url text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_documents_case_id on documents(case_id);
create index if not exists idx_documents_uploaded_by on documents(uploaded_by);
create index if not exists idx_documents_uploaded_at on documents(uploaded_at desc);

-- ─── Case Attachments ─────────────────────────────────────────
create table if not exists case_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  file_name text not null,
  file_type document_type_enum not null,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  storage_path text not null unique,
  uploaded_by uuid references employees(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  notes text,
  deleted_at timestamptz
);

create index if not exists idx_case_attachments_case_id on case_attachments(case_id);

-- ─── Notifications ────────────────────────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  title text not null,
  message text not null,
  type notification_type_enum not null default 'system',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_firm_id on notifications(firm_id);
create index if not exists idx_notifications_employee_id on notifications(employee_id);
create index if not exists idx_notifications_read on notifications(read) where read = false;
create index if not exists idx_notifications_created_at on notifications(created_at desc);

-- ─── Audit Logs ───────────────────────────────────────────────
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  changed_by uuid references employees(id) on delete set null,
  changes jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_table_name on audit_logs(table_name);
create index if not exists idx_audit_logs_record_id on audit_logs(record_id);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);

-- ─── Error Logs ───────────────────────────────────────────────
create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  message text not null,
  stack text,
  context jsonb,
  severity text not null default 'error' check (severity in ('info','warning','error','critical')),
  created_at timestamptz not null default now()
);

create index if not exists idx_error_logs_created_at on error_logs(created_at desc);
create index if not exists idx_error_logs_severity on error_logs(severity);

-- ─── Triggers ─────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$ declare t text; begin
  foreach t in array array['firms','employees','clients','cases','sessions','documents','lawyers']
  loop
    execute format('drop trigger if exists set_updated_at_%s on %I', t, t);
    execute format('create trigger set_updated_at_%s before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Auto-increment client cases_count
create or replace function update_client_cases_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update clients set cases_count = cases_count + 1 where id = new.client_id;
  elsif tg_op = 'DELETE' then
    update clients set cases_count = greatest(0, cases_count - 1) where id = old.client_id;
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists trg_cases_count on cases;
create trigger trg_cases_count
  after insert or delete on cases
  for each row execute function update_client_cases_count();

-- Audit log helper
create or replace function get_current_employee_id()
returns uuid as $$
  select id from employees where auth_uid = auth.uid() limit 1;
$$ language sql stable security definer;

create or replace function get_current_firm_id()
returns uuid as $$
  select firm_id from employees where auth_uid = auth.uid() limit 1;
$$ language sql stable security definer;

create or replace function get_current_role()
returns employee_role_enum as $$
  select role from employees where auth_uid = auth.uid() limit 1;
$$ language sql stable security definer;

create or replace function insert_audit_log()
returns trigger as $$
declare
  changes jsonb;
  emp_id uuid;
begin
  emp_id := get_current_employee_id();
  if tg_op = 'INSERT' then changes = row_to_json(new)::jsonb;
  elsif tg_op = 'UPDATE' then changes = jsonb_build_object('old', row_to_json(old), 'new', row_to_json(new));
  elsif tg_op = 'DELETE' then changes = row_to_json(old)::jsonb;
  end if;
  insert into audit_logs(table_name, record_id, operation, changed_by, changes)
  values (tg_table_name, coalesce(new.id, old.id), tg_op, emp_id, changes);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql security definer;

do $$ declare t text; begin
  foreach t in array array['clients','cases','sessions','documents','case_attachments','employees']
  loop
    execute format('drop trigger if exists audit_%s on %I', t, t);
    execute format('create trigger audit_%s after insert or update or delete on %I for each row execute function insert_audit_log()', t, t);
  end loop;
end $$;

-- Auto-create employee on signup
create or replace function handle_new_user()
returns trigger as $$
declare
  new_firm_id uuid;
  meta jsonb;
begin
  meta := new.raw_user_meta_data;
  insert into firms (name, plan) values (
    coalesce(meta->>'company', 'مكتب جديد'),
    'free'
  ) returning id into new_firm_id;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─── Row Level Security ───────────────────────────────────────
alter table firms enable row level security;
alter table employees enable row level security;
alter table clients enable row level security;
alter table cases enable row level security;
alter table sessions enable row level security;
alter table documents enable row level security;
alter table case_attachments enable row level security;
alter table lawyers enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table error_logs enable row level security;

-- Firms
create policy "firms_select_own" on firms for select
  using (id = get_current_firm_id());
create policy "firms_update_admin" on firms for update
  using (id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager'));

-- Employees
create policy "employees_select_firm" on employees for select
  using (firm_id = get_current_firm_id() and deleted_at is null);
create policy "employees_insert_admin" on employees for insert
  with check (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager'));
create policy "employees_update_admin" on employees for update
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager'));
create policy "employees_delete_admin" on employees for delete
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin'));

-- Clients
create policy "clients_select_firm" on clients for select
  using (firm_id = get_current_firm_id() and deleted_at is null);
create policy "clients_insert_firm" on clients for insert
  with check (firm_id = get_current_firm_id() and auth.role() = 'authenticated');
create policy "clients_update_firm" on clients for update
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager','lawyer'));
create policy "clients_soft_delete_admin" on clients for update
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager'));

-- Cases
create policy "cases_select_firm" on cases for select
  using (firm_id = get_current_firm_id() and deleted_at is null);
create policy "cases_insert_firm" on cases for insert
  with check (firm_id = get_current_firm_id() and auth.role() = 'authenticated');
create policy "cases_update_firm" on cases for update
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager','lawyer'));
create policy "cases_delete_admin" on cases for delete
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager'));

-- Sessions
create policy "sessions_select_firm" on sessions for select
  using (exists (select 1 from cases c where c.id = sessions.case_id and c.firm_id = get_current_firm_id()));
create policy "sessions_insert_firm" on sessions for insert
  with check (exists (select 1 from cases c where c.id = case_id and c.firm_id = get_current_firm_id()));
create policy "sessions_update_firm" on sessions for update
  using (exists (select 1 from cases c where c.id = sessions.case_id and c.firm_id = get_current_firm_id()));
create policy "sessions_delete_firm" on sessions for delete
  using (exists (select 1 from cases c where c.id = sessions.case_id and c.firm_id = get_current_firm_id()) and get_current_role() in ('super_admin','admin','firm_manager'));

-- Documents
create policy "documents_select_firm" on documents for select
  using (exists (select 1 from cases c where c.id = documents.case_id and c.firm_id = get_current_firm_id()));
create policy "documents_insert_firm" on documents for insert
  with check (exists (select 1 from cases c where c.id = case_id and c.firm_id = get_current_firm_id()));
create policy "documents_delete_admin" on documents for delete
  using (exists (select 1 from cases c where c.id = documents.case_id and c.firm_id = get_current_firm_id()) and get_current_role() in ('super_admin','admin','firm_manager'));

-- Case Attachments
create policy "attachments_select_firm" on case_attachments for select
  using (exists (select 1 from cases c where c.id = case_attachments.case_id and c.firm_id = get_current_firm_id()));
create policy "attachments_insert_firm" on case_attachments for insert
  with check (exists (select 1 from cases c where c.id = case_id and c.firm_id = get_current_firm_id()));

-- Lawyers
create policy "lawyers_select_firm" on lawyers for select
  using (exists (select 1 from employees e where e.id = lawyers.employee_id and e.firm_id = get_current_firm_id()));
create policy "lawyers_insert_admin" on lawyers for insert
  with check (exists (select 1 from employees e where e.id = employee_id and e.firm_id = get_current_firm_id()) and get_current_role() in ('super_admin','admin','firm_manager'));

-- Notifications
create policy "notifications_select_own" on notifications for select
  using (firm_id = get_current_firm_id() and (employee_id is null or employee_id = get_current_employee_id()));
create policy "notifications_update_own" on notifications for update
  using (firm_id = get_current_firm_id() and (employee_id is null or employee_id = get_current_employee_id()));
create policy "notifications_insert_system" on notifications for insert
  with check (firm_id = get_current_firm_id());

-- Audit Logs (read-only for admins)
create policy "audit_logs_select_admin" on audit_logs for select
  using (get_current_role() in ('super_admin','admin'));

-- Error Logs
create policy "error_logs_insert" on error_logs for insert
  with check (auth.role() = 'authenticated');
create policy "error_logs_select_admin" on error_logs for select
  using (get_current_role() in ('super_admin','admin'));

-- ─── Storage Bucket ───────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-documents',
  'case-documents',
  false,
  52428800,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp']
) on conflict (id) do update set
  file_size_limit = 52428800,
  allowed_mime_types = array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp'];

create policy "storage_select_firm" on storage.objects for select
  using (bucket_id = 'case-documents' and auth.role() = 'authenticated');
create policy "storage_insert_firm" on storage.objects for insert
  with check (bucket_id = 'case-documents' and auth.role() = 'authenticated');
create policy "storage_delete_admin" on storage.objects for delete
  using (bucket_id = 'case-documents' and get_current_role() in ('super_admin','admin','firm_manager'));
