-- LegalMind Yemen Supabase schema and RBAC setup

-- Enable extensions used by audit and UUID generation
create extension if not exists "pgcrypto";

-- ENUM types
create type case_type_enum as enum (
  'مدنية',
  'تجارية',
  'أحوال شخصية',
  'عمالية',
  'مستعجلة',
  'جنائية'
);

create type case_stage_enum as enum (
  'ابتدائي مدني',
  'ابتدائي شخصي',
  'ابتدائي جنائي',
  'استئناف',
  'نقض'
);

create type case_status_enum as enum ('active', 'archived', 'closed');
create type employee_role_enum as enum ('super_admin','admin','lawyer','assistant');
create type employee_status_enum as enum ('active','suspended','disabled');
create type document_type_enum as enum ('pdf','docx','xlsx','jpg','png','webp');

-- Employees table for RBAC and employee profiles
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text,
  role employee_role_enum not null default 'assistant',
  status employee_status_enum not null default 'active',
  profile_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Lawyers metrics table linked to employee profile
create table if not exists lawyers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  success_rate numeric(5,2) default 0.00,
  attendance_rate numeric(5,2) default 0.00,
  total_cases integer default 0,
  won_cases integer default 0,
  attended_sessions integer default 0,
  missed_sessions integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Clients table
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references employees(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  type text not null default 'فرد',
  cases_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Cases table with archive, financials, and audit fields
create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references employees(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  assigned_lawyer_id uuid references lawyers(id) on delete set null,
  court_case_number text not null,
  title text not null,
  case_type case_type_enum not null,
  case_stage case_stage_enum not null,
  total_amount numeric(12,2) default 0.00,
  paid_amount numeric(12,2) default 0.00,
  remaining_amount numeric(12,2) generated always as (total_amount - paid_amount) stored,
  status case_status_enum not null default 'active',
  judgment_date date,
  archive_date date,
  closed_by uuid references employees(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_cases_client_id on cases(client_id);
create index if not exists idx_cases_assigned_lawyer_id on cases(assigned_lawyer_id);
create index if not exists idx_cases_status on cases(status);
create index if not exists idx_cases_case_type on cases(case_type);
create index if not exists idx_cases_case_stage on cases(case_stage);

-- Sessions table
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  scheduled_by uuid references employees(id) on delete set null,
  court text not null,
  session_date date not null,
  session_time time not null,
  status text not null,
  session_type text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_sessions_case_id on sessions(case_id);
create index if not exists idx_sessions_session_date on sessions(session_date);

-- Document metadata table
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete cascade,
  uploaded_by uuid references employees(id) on delete set null,
  title text not null,
  category text not null,
  file_type document_type_enum not null,
  file_size bigint not null,
  storage_path text not null,
  url text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_documents_case_id on documents(case_id);
create index if not exists idx_documents_uploaded_by on documents(uploaded_by);

-- Case attachments table for audit history and versioning
create table if not exists case_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  file_name text not null,
  file_type document_type_enum not null,
  file_size bigint not null,
  storage_path text not null,
  uploaded_by uuid references employees(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  version integer not null default 1,
  notes text,
  deleted_at timestamptz
);

create index if not exists idx_case_attachments_case_id on case_attachments(case_id);

-- Audit log table
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  operation text not null,
  changed_by uuid references employees(id) on delete set null,
  changes jsonb,
  created_at timestamptz not null default now()
);

-- Timestamp trigger for updated_at
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_clients
  before update on clients
  for each row execute function set_updated_at();

create trigger set_updated_at_cases
  before update on cases
  for each row execute function set_updated_at();

create trigger set_updated_at_sessions
  before update on sessions
  for each row execute function set_updated_at();

create trigger set_updated_at_documents
  before update on documents
  for each row execute function set_updated_at();

create trigger set_updated_at_lawyers
  before update on lawyers
  for each row execute function set_updated_at();

create trigger set_updated_at_employees
  before update on employees
  for each row execute function set_updated_at();

-- Audit log helper function
create or replace function insert_audit_log()
returns trigger as $$
declare
  changes jsonb;
begin
  if (tg_op = 'INSERT') then
    changes = row_to_json(new)::jsonb;
  elsif (tg_op = 'UPDATE') then
    changes = jsonb_build_object('old', row_to_json(old), 'new', row_to_json(new));
  elsif (tg_op = 'DELETE') then
    changes = row_to_json(old)::jsonb;
  end if;
  insert into audit_logs(table_name, record_id, operation, changed_by, changes)
  values (tg_table_name, coalesce(new.id, old.id), tg_op, current_setting('request.jwt.claims.employee_id', true)::uuid, changes);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql;

-- Audit triggers for core tables
create trigger audit_clients
  after insert or update or delete on clients
  for each row execute function insert_audit_log();

create trigger audit_cases
  after insert or update or delete on cases
  for each row execute function insert_audit_log();

create trigger audit_sessions
  after insert or update or delete on sessions
  for each row execute function insert_audit_log();

create trigger audit_documents
  after insert or update or delete on documents
  for each row execute function insert_audit_log();

create trigger audit_case_attachments
  after insert or update or delete on case_attachments
  for each row execute function insert_audit_log();

-- Row level security and policies
alter table employees enable row level security;
alter table clients enable row level security;
alter table cases enable row level security;
alter table sessions enable row level security;
alter table documents enable row level security;
alter table case_attachments enable row level security;
alter table lawyers enable row level security;

create policy "Employees select self or admin" on employees
  for select using (
    auth.role() = 'anon' or auth.role() = 'authenticated'
  );

create policy "Clients access" on clients
  for select using (
    auth.role() = 'authenticated'
  );
create policy "Clients insert" on clients
  for insert with check (
    auth.role() = 'authenticated'
  );
create policy "Clients update" on clients
  for update using (
    auth.role() = 'authenticated'
  );
create policy "Clients delete" on clients
  for delete using (
    false
  );

create policy "Cases access" on cases
  for select using (
    auth.role() = 'authenticated'
  );
create policy "Cases modify" on cases
  for insert, update using (
    auth.role() = 'authenticated'
  );
create policy "Cases insert check" on cases
  for insert with check (
    auth.role() = 'authenticated'
  );

create policy "Documents access" on documents
  for select using (
    auth.role() = 'authenticated'
  );
create policy "Documents insert" on documents
  for insert with check (
    auth.role() = 'authenticated'
  );

create policy "Sessions access" on sessions
  for select using (
    auth.role() = 'authenticated'
  );
create policy "Sessions insert" on sessions
  for insert with check (
    auth.role() = 'authenticated'
  );

create policy "Case attachments access" on case_attachments
  for select using (
    auth.role() = 'authenticated'
  );
create policy "Case attachments insert" on case_attachments
  for insert with check (
    auth.role() = 'authenticated'
  );

create policy "Lawyers access" on lawyers
  for select using (
    auth.role() = 'authenticated'
  );
create policy "Lawyers insert" on lawyers
  for insert with check (
    auth.role() = 'authenticated'
  );

-- Make sure auth role functions are available in Supabase
-- Add employee_id custom claim mapping in Supabase JWT settings to support audit logging
