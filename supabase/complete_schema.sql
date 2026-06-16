-- =============================================================================
-- LegalMind Yemen — Complete Supabase PostgreSQL Schema
-- ⚠️  This file is a REFERENCE only. For production use, always run
--     migrations 001 → 034 in order via Supabase SQL Editor.
--     Last synced with migrations: 034_performance_and_hardening.sql
-- =============================================================================

-- Extensions
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to authenticated, anon, service_role;

-- Legacy alias so older functions that call gen_random_bytes() without schema still work
create extension if not exists pgcrypto;  -- in public for legacy

-- ─── ENUM types ───────────────────────────────────────────────────────────────
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

do $$ begin
  create type profile_role_enum as enum ('admin','lawyer','assistant');
exception when duplicate_object then null; end $$;

-- ─── Core tenant table: firms ─────────────────────────────────────────────────
create table if not exists firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_no text,
  owner_full_name text,
  email text,
  phone text,
  firm_code varchar(12),
  plan text not null default 'free' check (plan in ('free','pro','enterprise')),
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint firms_email_format check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  constraint firms_owner_name_length check (owner_full_name is null or char_length(owner_full_name) >= 2),
  constraint firms_phone_format check (phone is null or phone ~ '^[0-9+ -]{7,20}$'),
  constraint firms_firm_code_format check (firm_code is null or firm_code ~ '^[A-Z]{3}-[0-9]{4}$')
);

create unique index if not exists firms_firm_code_unique_idx on firms(firm_code);
create index if not exists idx_firms_code on firms(firm_code);

-- ─── Employees ────────────────────────────────────────────────────────────────
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
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_employees_auth_uid on employees(auth_uid);
create index if not exists idx_employees_firm_id on employees(firm_id);
create index if not exists idx_employees_role on employees(role);
create index if not exists idx_employees_firm_auth_uid on employees(firm_id, auth_uid);
create index if not exists idx_employees_firm_role on employees(firm_id, role);

-- ─── Profiles (auth.users ↔ firms) ────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  employee_id uuid unique references employees(id) on delete set null,
  full_name text not null check (char_length(full_name) >= 2),
  email text not null unique check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  role profile_role_enum not null,
  phone text check (phone is null or phone ~ '^[0-9+ -]{7,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_profiles_firm_id on profiles(firm_id);
create index if not exists idx_profiles_role on profiles(role);

-- ─── Lawyers ──────────────────────────────────────────────────────────────────
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
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Invitations ──────────────────────────────────────────────────────────────
create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  email text not null check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  full_name text,
  phone text,
  role employee_role_enum not null check (role in ('lawyer','assistant')),
  status text not null default 'pending' check (status in ('pending','accepted','expired','cancelled')),
  token_hash text not null unique,
  invited_by uuid references employees(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  invite_url text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  resent_at timestamptz,
  cancelled_at timestamptz,
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_invitations_pending_email
  on invitations(firm_id, lower(email)) where status = 'pending';
create index if not exists idx_invitations_firm_status on invitations(firm_id, status);
create index if not exists idx_invitations_firm_email on invitations(firm_id, lower(email));
create index if not exists idx_invitations_token_hash on invitations(token_hash);
create index if not exists idx_invitations_expires_at on invitations(expires_at);

-- ─── Clients ──────────────────────────────────────────────────────────────────
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  name text not null check (char_length(name) >= 2),
  phone text check (phone is null or phone ~ '^[0-9]{9,15}$'),
  email text check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  address text,
  type text not null default 'فرد' check (type in ('فرد','شركة تجارية')),
  cases_count integer not null default 0 check (cases_count >= 0),
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (firm_id, phone)
);

create index if not exists idx_clients_firm_id on clients(firm_id);
create index if not exists idx_clients_name on clients(name);
create index if not exists idx_clients_created_at on clients(created_at desc);

-- ─── Cases ────────────────────────────────────────────────────────────────────
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
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
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
create index if not exists idx_cases_firm_assigned_lawyer on cases(firm_id, assigned_lawyer_id);

-- ─── Sessions ─────────────────────────────────────────────────────────────────
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
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_sessions_case_id on sessions(case_id);
create index if not exists idx_sessions_case_deleted on sessions(case_id, deleted_at);

-- ─── Documents ────────────────────────────────────────────────────────────────
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
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_documents_case_id on documents(case_id);
create index if not exists idx_documents_case_deleted on documents(case_id, deleted_at);

-- ─── Case Attachments ─────────────────────────────────────────────────────────
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
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  deleted_at timestamptz
);

create index if not exists idx_case_attachments_case_id on case_attachments(case_id);
create index if not exists idx_case_attachments_case_deleted on case_attachments(case_id, deleted_at);

-- ─── Notifications ────────────────────────────────────────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  title text not null,
  message text not null,
  type notification_type_enum not null default 'system',
  read boolean not null default false,
  sync_version bigint not null default 1,
  updated_by uuid,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_firm_id on notifications(firm_id);

-- ─── Audit & Error Logs ───────────────────────────────────────────────────────
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

-- ─── Offline Sync ─────────────────────────────────────────────────────────────
create table if not exists sync_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null unique,
  firm_id uuid references firms(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  created_by uuid references employees(id) on delete set null,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_events_firm_created on sync_events(firm_id, created_at);

-- ─── Utility triggers ─────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$ declare t text; begin
  foreach t in array array['firms','employees','profiles','clients','cases','sessions','documents','lawyers','invitations']
  loop
    execute format('drop trigger if exists set_updated_at_%s on %I', t, t);
    execute format('create trigger set_updated_at_%s before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

create or replace function bump_sync_metadata()
returns trigger as $$
begin
  new.sync_version = coalesce(old.sync_version, 0) + 1;
  new.updated_by = get_current_employee_id();
  if new.updated_at is null or new.updated_at = old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

do $$ declare t text; begin
  foreach t in array array['firms','employees','invitations','clients','cases','sessions','documents','case_attachments','lawyers','notifications']
  loop
    execute format('drop trigger if exists sync_metadata_%s on %I', t, t);
    execute format('create trigger sync_metadata_%s before update on %I for each row execute function bump_sync_metadata()', t, t);
  end loop;
end $$;

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

-- ─── Firm code generation ─────────────────────────────────────────────────────
create or replace function firm_code_prefix(firm_name text)
returns text as $$
declare
  cleaned text;
  parts text[];
  prefix text := '';
  part text;
begin
  cleaned := upper(regexp_replace(coalesce(firm_name, ''), '[^[:alnum:] ]', ' ', 'g'));
  parts := regexp_split_to_array(trim(cleaned), '\s+');
  foreach part in array parts loop
    if length(part) >= 3 then
      prefix := substr(part, 1, 3);
      exit;
    elsif length(part) > 0 then
      prefix := prefix || substr(part, 1, 1);
    end if;
  end loop;
  prefix := regexp_replace(prefix, '[^A-Z0-9]', '', 'g');
  if length(prefix) < 3 then prefix := rpad(prefix, 3, 'X'); end if;
  return substr(prefix, 1, 3);
end;
$$ language plpgsql immutable;

create or replace function generate_firm_code(firm_name text)
returns varchar as $$
declare
  prefix text;
  candidate varchar(12);
  attempt int := 0;
begin
  prefix := firm_code_prefix(firm_name);
  perform pg_advisory_xact_lock(hashtext('legalmind_yemen_firm_code_generation'));
  loop
    attempt := attempt + 1;
    if attempt > 100 then
      raise exception 'Could not generate a unique firm code after % attempts', attempt
        using errcode = 'unique_violation';
    end if;
    candidate := prefix || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from firms where firm_code = candidate);
  end loop;
  return candidate;
end;
$$ language plpgsql volatile;

create or replace function set_firm_code()
returns trigger as $$
begin
  perform pg_advisory_xact_lock(hashtext('legalmind_yemen_firm_code_generation'));
  if new.firm_code is null or trim(new.firm_code) = '' then
    new.firm_code := generate_firm_code(new.name);
  else
    new.firm_code := upper(trim(new.firm_code));
  end if;
  return new;
exception when unique_violation then
  new.firm_code := generate_firm_code(new.name);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_firm_code on firms;
create trigger trg_set_firm_code
  before insert on firms
  for each row execute function set_firm_code();

-- ─── Auth / tenant helpers ────────────────────────────────────────────────────
create or replace function get_current_employee_id()
returns uuid as $$
  select employee_id from profiles where id = auth.uid() and deleted_at is null limit 1;
$$ language sql stable security definer;

create or replace function get_current_firm_id()
returns uuid as $$
  select coalesce(
    (select firm_id from profiles where id = auth.uid() and deleted_at is null limit 1),
    (select firm_id from employees where auth_uid = auth.uid() and deleted_at is null limit 1)
  );
$$ language sql stable security definer;

create or replace function get_current_office_id()
returns uuid as $$
  select get_current_firm_id();
$$ language sql stable security definer;

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

create or replace function get_current_role()
returns employee_role_enum as $$
  select e.role
  from profiles p
  join employees e on e.id = p.employee_id
  where p.id = auth.uid() and p.deleted_at is null
  limit 1;
$$ language sql stable security definer;

create or replace function is_office_profile_admin()
returns boolean as $$
  select coalesce(get_current_profile_role() = 'admin', false);
$$ language sql stable security definer;

create or replace function is_office_admin()
returns boolean as $$
  select coalesce(get_current_role() in ('super_admin','admin','firm_manager'), false);
$$ language sql stable security definer;

create or replace function is_current_user_office_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and deleted_at is null
  );
$$ language sql stable security definer;

create or replace function get_current_lawyer_id()
returns uuid as $$
  select l.id
  from lawyers l
  join employees e on e.id = l.employee_id
  where e.auth_uid = auth.uid() and e.status = 'active' and e.deleted_at is null
  limit 1;
$$ language sql stable security definer;

create or replace function can_access_case(target_case_id uuid)
returns boolean as $$
  select exists (
    select 1 from cases c
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

-- ─── Registration flows ───────────────────────────────────────────────────────
create or replace function create_office_admin_profile(
  auth_user_id uuid,
  office_name text,
  owner_name text,
  owner_email text,
  owner_phone text
)
returns uuid as $$
declare
  new_firm_id uuid;
  new_employee_id uuid;
begin
  insert into firms(name, owner_full_name, email, phone, plan)
  values (office_name, owner_name, owner_email, owner_phone, 'free')
  returning id into new_firm_id;

  insert into employees(auth_uid, firm_id, full_name, email, phone, role, status)
  values (auth_user_id, new_firm_id, owner_name, owner_email, owner_phone, 'admin', 'active')
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role, phone)
  values (auth_user_id, new_firm_id, new_employee_id, owner_name, owner_email, 'admin', owner_phone);

  return new_firm_id;
end;
$$ language plpgsql security definer;

create or replace function create_lawyer_profile(
  auth_user_id uuid,
  firm_code_input text,
  lawyer_name text,
  lawyer_email text
)
returns uuid as $$
declare
  target_firm firms%rowtype;
  new_employee_id uuid;
begin
  select * into target_firm
  from firms
  where upper(firm_code) = upper(trim(firm_code_input)) and deleted_at is null;

  if not found then
    raise exception 'Firm code does not exist';
  end if;

  insert into employees(auth_uid, firm_id, full_name, email, role, status)
  values (auth_user_id, target_firm.id, lawyer_name, lawyer_email, 'lawyer', 'active')
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role)
  values (auth_user_id, target_firm.id, new_employee_id, lawyer_name, lawyer_email, 'lawyer');

  return target_firm.id;
end;
$$ language plpgsql security definer;

create or replace function handle_new_user()
returns trigger as $$
declare
  meta jsonb;
  flow text;
begin
  meta := new.raw_user_meta_data;
  flow := coalesce(meta->>'registration_flow', '');

  if flow = 'office' then
    perform create_office_admin_profile(
      new.id,
      coalesce(meta->>'office_name', meta->>'company', 'مكتب محاماة'),
      coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
      new.email,
      nullif(meta->>'phone', '')
    );
    return new;
  end if;

  if flow = 'invite' then
    perform create_invited_profile(
      new.id,
      coalesce(meta->>'invitation_token', ''),
      coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  if flow = 'lawyer' then
    perform create_lawyer_profile(
      new.id,
      coalesce(meta->>'firm_code', meta->>'office_code', ''),
      coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  perform create_office_admin_profile(
    new.id,
    coalesce(meta->>'company', 'مكتب محاماة'),
    coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    nullif(meta->>'phone', '')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─── Invitations ──────────────────────────────────────────────────────────────
create or replace function invitation_hash(raw_token text)
returns text as $$
  select encode(digest(raw_token, 'sha256'), 'hex');
$$ language sql immutable security definer;

create or replace function expire_old_invitations()
returns void as $$
begin
  update invitations set status = 'expired'
  where status = 'pending' and expires_at <= now();
end;
$$ language plpgsql security definer;

drop function if exists get_invitation_by_token(text);

create function get_invitation_by_token(raw_token text)
returns table (
  id uuid,
  firm_id uuid,
  office_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz
) as $$
begin
  perform expire_old_invitations();
  return query
  select i.id, i.firm_id, f.name, i.email, i.role::text, i.status, i.expires_at
  from invitations i
  join firms f on f.id = i.firm_id
  where i.token_hash = invitation_hash(raw_token)
  limit 1;
end;
$$ language plpgsql stable security definer;

create or replace function create_invited_profile(
  auth_user_id uuid,
  raw_token text,
  invited_name text,
  invited_email text
)
returns uuid as $$
declare
  inv invitations%rowtype;
  target_firm firms%rowtype;
  new_employee_id uuid;
begin
  perform expire_old_invitations();
  select * into inv from invitations where token_hash = invitation_hash(raw_token) for update;
  if not found or inv.status <> 'pending' or inv.expires_at <= now() then
    raise exception 'Invitation is invalid or expired';
  end if;
  if lower(inv.email) <> lower(invited_email) then
    raise exception 'Invitation email does not match';
  end if;
  select * into target_firm from firms where id = inv.firm_id and deleted_at is null;
  if not found then raise exception 'Firm not found'; end if;

  insert into employees(auth_uid, firm_id, full_name, email, role, status)
  values (auth_user_id, target_firm.id, invited_name, inv.email, inv.role, 'active')
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role)
  values (auth_user_id, inv.firm_id, new_employee_id, invited_name, inv.email, inv.role::text::profile_role_enum);

  update invitations set status = 'accepted', accepted_at = now(), employee_id = new_employee_id
  where id = inv.id;

  return inv.firm_id;
end;
$$ language plpgsql security definer;

create or replace function create_office_invitation(
  invite_email text,
  invite_role text,
  app_origin text default null
)
returns table (id uuid, email text, role text, status text, expires_at timestamptz, invite_url text) as $$
declare
  current_profile profiles%rowtype;
  raw_token text;
  hashed_token text;
  new_invitation invitations%rowtype;
  base_url text;
begin
  perform expire_old_invitations();
  select * into current_profile from profiles where id = auth.uid() and deleted_at is null;
  if not found or current_profile.role <> 'admin' then
    raise exception 'Only firm admins can create invitations';
  end if;
  if invite_role not in ('lawyer','assistant') then
    raise exception 'Invalid invitation role';
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');
  hashed_token := invitation_hash(raw_token);
  base_url := coalesce(nullif(trim(app_origin), ''), 'https://app.com');

  insert into invitations (firm_id, email, role, status, token_hash, invited_by, expires_at, invite_url)
  values (
    current_profile.firm_id,
    lower(trim(invite_email)),
    invite_role::employee_role_enum,
    'pending',
    hashed_token,
    current_profile.employee_id,
    now() + interval '7 days',
    base_url || '/invite/' || raw_token
  )
  returning * into new_invitation;

  return query select new_invitation.id, new_invitation.email, new_invitation.role::text,
    new_invitation.status, new_invitation.expires_at, new_invitation.invite_url;
end;
$$ language plpgsql security definer;

-- ─── Firm code lookup RPCs ────────────────────────────────────────────────────
create or replace function get_office_by_firm_code(firm_code_input text)
returns table(id uuid, name text, firm_code varchar) as $$
begin
  return query
  select f.id, f.name, f.firm_code
  from firms f
  where upper(f.firm_code) = upper(trim(firm_code_input)) and f.deleted_at is null
  limit 1;
end;
$$ language plpgsql stable security definer;

drop function if exists get_office_by_code(text);
create function get_office_by_code(office_code_input text)
returns table(id uuid, name text, office_code text, firm_code varchar) as $$
begin
  return query
  select f.id, f.name, f.firm_code, f.firm_code
  from firms f
  where upper(f.firm_code) = upper(trim(office_code_input)) and f.deleted_at is null
  limit 1;
end;
$$ language plpgsql stable security definer;

create or replace function office_code_exists(office_code_input text)
returns boolean as $$
  select exists (
    select 1 from firms
    where upper(firm_code) = upper(trim(office_code_input)) and deleted_at is null
  );
$$ language sql stable security definer;

drop function if exists get_current_profile_context();

create function get_current_profile_context()
returns table (
  profile_id uuid, firm_id uuid, employee_id uuid,
  full_name text, email text, role text,
  firm_name text, firm_code text
) as $$
begin
  return query
  select p.id, p.firm_id, p.employee_id, p.full_name, p.email, p.role::text, f.name, f.firm_code
  from profiles p
  join firms f on f.id = p.firm_id
  where p.id = auth.uid() and p.deleted_at is null and f.deleted_at is null
  limit 1;
end;
$$ language plpgsql stable security definer;

-- ─── Lawyer sync & case validation ────────────────────────────────────────────
create or replace function sync_lawyer_profile()
returns trigger as $$
begin
  if new.role = 'lawyer' and new.status = 'active' and new.deleted_at is null then
    insert into lawyers (employee_id) values (new.id) on conflict (employee_id) do nothing;
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

create or replace function validate_case_tenant_links()
returns trigger as $$
declare client_firm uuid; lawyer_firm uuid;
begin
  select firm_id into client_firm from clients where id = new.client_id and deleted_at is null;
  if client_firm is null or client_firm <> new.firm_id then
    raise exception 'Client must belong to the same firm as the case';
  end if;
  if new.assigned_lawyer_id is not null then
    select e.firm_id into lawyer_firm
    from lawyers l join employees e on e.id = l.employee_id
    where l.id = new.assigned_lawyer_id and e.deleted_at is null and e.status = 'active';
    if lawyer_firm is null or lawyer_firm <> new.firm_id then
      raise exception 'Assigned lawyer must belong to the same firm as the case';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_validate_case_tenant_links on cases;
create trigger trg_validate_case_tenant_links
  before insert or update of firm_id, client_id, assigned_lawyer_id on cases
  for each row execute function validate_case_tenant_links();

-- ─── Sync RPCs ────────────────────────────────────────────────────────────────
create or replace function ensure_sync_table_allowed(table_name text)
returns void as $$
begin
  if table_name not in ('firms','employees','invitations','clients','cases','sessions','documents','case_attachments','lawyers','notifications') then
    raise exception 'Unsupported sync table: %', table_name;
  end if;
end;
$$ language plpgsql immutable;

create or replace function sync_pull_table(table_name text, since_cursor text default null)
returns setof jsonb as $$
declare sql text;
begin
  perform ensure_sync_table_allowed(table_name);
  sql := format(
    'select to_jsonb(t) from %I t where ($1 is null or t.updated_at > $1::timestamptz) order by t.updated_at asc limit 500',
    table_name
  );
  return query execute sql using since_cursor;
end;
$$ language plpgsql security definer;

create or replace function sync_apply_event(
  event_id text, table_name text, record_id uuid,
  firm_id uuid, event_type text, payload jsonb
)
returns void as $$
declare existing_event uuid;
begin
  perform ensure_sync_table_allowed(table_name);
  select id into existing_event from sync_events where client_event_id = event_id;
  if existing_event is not null then return; end if;

  insert into sync_events(client_event_id, firm_id, table_name, record_id, event_type, payload, created_by)
  values (event_id, coalesce(firm_id, get_current_firm_id()), table_name, record_id, event_type, payload, get_current_employee_id());

  if event_type like '%.deleted' then
    execute format(
      'update %I set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()), updated_at = now(), updated_by = get_current_employee_id() where id = $2',
      table_name
    ) using payload, record_id;
  end if;
end;
$$ language plpgsql security definer;

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table firms enable row level security;
alter table employees enable row level security;
alter table profiles enable row level security;
alter table clients enable row level security;
alter table cases enable row level security;
alter table sessions enable row level security;
alter table documents enable row level security;
alter table case_attachments enable row level security;
alter table lawyers enable row level security;
alter table invitations enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table error_logs enable row level security;
alter table sync_events enable row level security;

-- Firms & Profiles
drop policy if exists "firms_select_member" on firms;
drop policy if exists "firms_update_admin" on firms;
create policy "firms_select_member" on firms for select using (id = get_current_firm_id());
create policy "firms_update_admin" on firms for update
  using (id = get_current_firm_id() and is_office_profile_admin())
  with check (id = get_current_firm_id() and is_office_profile_admin());

drop policy if exists "profiles_select_firm" on profiles;
drop policy if exists "profiles_update_admin_firm" on profiles;
create policy "profiles_select_firm" on profiles for select
  using (firm_id = get_current_firm_id() and deleted_at is null);
create policy "profiles_update_admin_firm" on profiles for update
  using (firm_id = get_current_firm_id() and is_office_profile_admin())
  with check (firm_id = get_current_firm_id() and is_office_profile_admin());

-- Employees
drop policy if exists "employees_select_office" on employees;
drop policy if exists "employees_insert_admin" on employees;
drop policy if exists "employees_update_admin" on employees;
drop policy if exists "employees_delete_admin" on employees;
create policy "employees_select_office" on employees for select
  using (firm_id = get_current_firm_id() and deleted_at is null);
create policy "employees_insert_admin" on employees for insert
  with check (firm_id = get_current_firm_id() and is_office_admin());
create policy "employees_update_admin" on employees for update
  using (firm_id = get_current_firm_id() and is_office_admin())
  with check (firm_id = get_current_firm_id() and is_office_admin());
create policy "employees_delete_admin" on employees for delete
  using (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin'));

-- Invitations
drop policy if exists "invitations_select_firm_admin" on invitations;
drop policy if exists "invitations_insert_firm_admin" on invitations;
drop policy if exists "invitations_update_firm_admin" on invitations;
create policy "invitations_select_firm_admin" on invitations for select
  using (firm_id = get_current_firm_id() and is_office_profile_admin());
create policy "invitations_insert_firm_admin" on invitations for insert
  with check (firm_id = get_current_firm_id() and is_office_profile_admin());
create policy "invitations_update_firm_admin" on invitations for update
  using (firm_id = get_current_firm_id() and is_office_profile_admin())
  with check (firm_id = get_current_firm_id() and is_office_profile_admin());

-- Cases (role-scoped)
drop policy if exists "cases_select_role_scoped" on cases;
drop policy if exists "cases_insert_staff" on cases;
drop policy if exists "cases_update_role_scoped" on cases;
drop policy if exists "cases_delete_admin" on cases;
create policy "cases_select_role_scoped" on cases for select
  using (firm_id = get_current_firm_id() and deleted_at is null and (
    is_office_admin() or get_current_role() = 'assistant'
    or (get_current_role() = 'lawyer' and assigned_lawyer_id = get_current_lawyer_id())
  ));
create policy "cases_insert_staff" on cases for insert
  with check (firm_id = get_current_firm_id() and get_current_role() in ('super_admin','admin','firm_manager','assistant'));
create policy "cases_update_role_scoped" on cases for update
  using (firm_id = get_current_firm_id() and (
    is_office_admin() or get_current_role() = 'assistant'
    or (get_current_role() = 'lawyer' and assigned_lawyer_id = get_current_lawyer_id())
  ))
  with check (firm_id = get_current_firm_id());
create policy "cases_delete_admin" on cases for delete
  using (firm_id = get_current_firm_id() and is_office_admin());

-- Sessions & Documents (case access)
drop policy if exists "sessions_select_case_access" on sessions;
create policy "sessions_select_case_access" on sessions for select
  using (deleted_at is null and can_access_case(case_id));

drop policy if exists "documents_select_case_access" on documents;
create policy "documents_select_case_access" on documents for select
  using (deleted_at is null and can_access_case(case_id));

-- Sync events
drop policy if exists "sync_events_select_office" on sync_events;
drop policy if exists "sync_events_insert_office" on sync_events;
create policy "sync_events_select_office" on sync_events for select
  using (firm_id = get_current_firm_id() and auth.role() = 'authenticated');
create policy "sync_events_insert_office" on sync_events for insert
  with check (firm_id = get_current_firm_id() and auth.role() = 'authenticated');

-- ─── New tables (023+) — subscriptions, execution requests ───────────────────
-- subscription_requests, execution_requests, client_report_logs are created in
-- migrations 023 and 028 respectively. They are NOT included in the original
-- complete_schema.sql. Apply migrations 023–034 for full coverage.

-- ─── Storage bucket ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-documents', 'case-documents', false, 52428800,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp']
) on conflict (id) do update set file_size_limit = 52428800;

create or replace function storage_case_id(object_name text)
returns uuid as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$ language sql immutable;

drop policy if exists "storage_select_case_access" on storage.objects;
create policy "storage_select_case_access" on storage.objects for select
  using (bucket_id = 'case-documents' and can_access_case(storage_case_id(name)));

-- ─── Grants + security hardening (Supabase linter) ────────────────────────────
-- See also: supabase/migrations/009_security_hardening.sql

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('alter function %s set search_path = public', fn.signature);
    execute format('revoke all on function %s from public', fn.signature);
    execute format('revoke all on function %s from anon', fn.signature);
    execute format('revoke all on function %s from authenticated', fn.signature);
  end loop;
end $$;

grant execute on function get_office_by_firm_code(text) to anon, authenticated;
grant execute on function get_office_by_code(text) to anon, authenticated;
grant execute on function office_code_exists(text) to anon, authenticated;
grant execute on function get_invitation_by_token(text) to anon, authenticated;
grant execute on function get_current_profile_context() to authenticated;
grant execute on function is_current_user_office_admin() to authenticated;
grant execute on function accept_invitation_for_auth_user(text) to authenticated;
grant execute on function create_office_invitation(text, text, text) to authenticated;
grant execute on function cancel_office_invitation(uuid) to authenticated;
grant execute on function resend_office_invitation(uuid, text) to authenticated;
grant execute on function sync_pull_table(text, text) to authenticated;
grant execute on function sync_apply_event(text, text, uuid, uuid, text, jsonb) to authenticated;

-- =============================================================================
-- ─── Migration 034 additions ─────────────────────────────────────────────────
-- Apply these after the above schema if running from scratch:
--
-- 1. pg_trgm GIN indexes (client/case/employee fuzzy search)
-- 2. Missing FK indexes (invitations.invited_by, sessions.scheduled_by, etc.)
-- 3. Partial/composite indexes for sync, calendar, and dashboard queries
-- 4. firm_id column on sessions with back-fill trigger
-- 5. Unique partial index: one pending subscription_request per firm
-- 6. Cross-tenant validation trigger for execution_requests
-- 7. Consolidated subscription_requests_select RLS policy (no duplicate permissive)
-- 8. Retention/TTL helper functions (purge_old_audit_logs, purge_old_error_logs, purge_old_invitations)
--
-- Run: supabase/migrations/034_performance_and_hardening.sql
-- =============================================================================

-- =============================================================================
-- Done. Verify with:
--   select tablename from pg_tables where schemaname = 'public' order by 1;
-- =============================================================================
