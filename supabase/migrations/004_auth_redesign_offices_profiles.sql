-- LegalMind Yemen - Authentication redesign
-- Firms are the canonical tenant table. Profiles link directly to firms via firm_id.

create extension if not exists "pgcrypto";

do $$ begin
  create type profile_role_enum as enum ('admin','lawyer','assistant');
exception when duplicate_object then null; end $$;

alter table firms add column if not exists owner_full_name text;
alter table firms add column if not exists email text;
alter table firms add column if not exists phone text;
alter table firms add column if not exists firm_code text;
alter table firms add column if not exists deleted_at timestamptz;

alter table firms drop constraint if exists firms_email_format;
alter table firms add constraint firms_email_format
  check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

alter table firms drop constraint if exists firms_owner_name_length;
alter table firms add constraint firms_owner_name_length
  check (owner_full_name is null or char_length(owner_full_name) >= 2);

alter table firms drop constraint if exists firms_phone_format;
alter table firms add constraint firms_phone_format
  check (phone is null or phone ~ '^[0-9+ -]{7,20}$');

alter table firms drop constraint if exists firms_firm_code_unique;
alter table firms add constraint firms_firm_code_unique unique (firm_code);

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

create index if not exists idx_firms_code on firms(firm_code);
create index if not exists idx_profiles_firm_id on profiles(firm_id);
create index if not exists idx_profiles_role on profiles(role);

drop trigger if exists set_updated_at_profiles on profiles;
create trigger set_updated_at_profiles
  before update on profiles
  for each row execute function set_updated_at();

create or replace function generate_office_code()
returns text as $$
declare
  candidate text;
begin
  loop
    candidate := 'LMY-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8));
    exit when not exists (select 1 from firms where firm_code = candidate);
  end loop;
  return candidate;
end;
$$ language plpgsql volatile;

create or replace function get_current_firm_id()
returns uuid as $$
  select firm_id from profiles where id = auth.uid() and deleted_at is null limit 1;
$$ language sql stable security definer;

create or replace function get_current_office_id()
returns uuid as $$
  select get_current_firm_id();
$$ language sql stable security definer;

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
  insert into firms(name, owner_full_name, email, phone, firm_code, plan)
  values (office_name, owner_name, owner_email, owner_phone, generate_office_code(), 'free')
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
  office_code_input text,
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
  where upper(firm_code) = upper(trim(office_code_input))
    and deleted_at is null;

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

drop function if exists get_office_by_code(text);
create function get_office_by_code(office_code_input text)
returns table(id uuid, name text, office_code text, firm_code text) as $$
begin
  return query
  select f.id, f.name, f.firm_code, f.firm_code
  from firms f
  where upper(f.firm_code) = upper(trim(office_code_input))
    and f.deleted_at is null
  limit 1;
end;
$$ language plpgsql stable security definer;

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

alter table firms enable row level security;
alter table profiles enable row level security;

drop policy if exists "firms_select_member" on firms;
drop policy if exists "firms_update_admin" on firms;
drop policy if exists "profiles_select_firm" on profiles;
drop policy if exists "profiles_update_admin_firm" on profiles;

create policy "firms_select_member" on firms for select
  using (id = get_current_firm_id());

create policy "firms_update_admin" on firms for update
  using (id = get_current_firm_id() and is_office_profile_admin())
  with check (id = get_current_firm_id() and is_office_profile_admin());

create policy "profiles_select_firm" on profiles for select
  using (firm_id = get_current_firm_id() and deleted_at is null);

create policy "profiles_update_admin_firm" on profiles for update
  using (firm_id = get_current_firm_id() and is_office_profile_admin())
  with check (firm_id = get_current_firm_id() and is_office_profile_admin());
