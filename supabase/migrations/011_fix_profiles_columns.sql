-- Fix incomplete profiles table (missing email and other columns from 004)

do $$ begin
  create type profile_role_enum as enum ('admin','lawyer','assistant');
exception when duplicate_object then null; end $$;

alter table profiles add column if not exists firm_id uuid references firms(id) on delete cascade;
alter table profiles add column if not exists employee_id uuid references employees(id) on delete set null;
alter table profiles add column if not exists full_name text;
alter table profiles add column if not exists email text;
alter table profiles add column if not exists role profile_role_enum;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists created_at timestamptz not null default now();
alter table profiles add column if not exists updated_at timestamptz not null default now();
alter table profiles add column if not exists deleted_at timestamptz;

-- Backfill email/full_name from auth.users where missing
update profiles p
set
  email = coalesce(p.email, u.email),
  full_name = coalesce(
    nullif(trim(p.full_name), ''),
    coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
  )
from auth.users u
where u.id = p.id
  and (p.email is null or trim(p.full_name) = '' or p.full_name is null);

-- Backfill role default for existing rows
update profiles set role = 'admin'::profile_role_enum where role is null;

create unique index if not exists profiles_email_unique_idx on profiles(email);
create index if not exists idx_profiles_firm_id on profiles(firm_id);
create index if not exists idx_profiles_role on profiles(role);

drop trigger if exists set_updated_at_profiles on profiles;
create trigger set_updated_at_profiles
  before update on profiles
  for each row execute function set_updated_at();

-- Allow users to read their own profile (fixes login profile fetch)
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles for select
  using (id = auth.uid() and deleted_at is null);
