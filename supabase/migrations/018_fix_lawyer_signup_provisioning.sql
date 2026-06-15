-- Fix lawyer registration "Database error saving new user"
-- Root cause: create_lawyer_profile inserted into lawyers AFTER employees insert,
-- but trg_sync_lawyer_profile already created the lawyers row → unique violation.
-- Also hardens SECURITY DEFINER provisioning with row_security = off.

-- ─── 1) Lawyer profile provisioning (idempotent lawyers row) ─────────────────

create or replace function create_lawyer_profile(
  auth_user_id uuid,
  office_code_input text,
  lawyer_name text,
  lawyer_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_firm_id uuid;
  new_employee_id uuid;
  normalized_code text := upper(trim(office_code_input));
  normalized_email text := lower(trim(lawyer_email));
  normalized_name text := trim(lawyer_name);
begin
  perform set_config('row_security', 'off', true);

  if char_length(normalized_name) < 2 then
    raise exception 'Lawyer name must be at least 2 characters'
      using errcode = 'check_violation';
  end if;

  if normalized_code = '' then
    raise exception 'Firm code is required'
      using errcode = 'check_violation';
  end if;

  if not is_valid_firm_code_format(normalized_code) then
    raise exception 'Invalid firm code format. Expected ABC-1234.'
      using errcode = 'check_violation';
  end if;

  select g.id into target_firm_id
  from get_office_by_firm_code(normalized_code) g
  limit 1;

  if target_firm_id is null then
    raise exception 'Firm code does not exist: %', normalized_code
      using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from employees e
    where lower(e.email) = normalized_email and e.deleted_at is null
  ) then
    raise exception 'Email already registered as an employee'
      using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from profiles p
    where lower(p.email) = normalized_email and p.deleted_at is null
  ) then
    raise exception 'Email already registered'
      using errcode = 'unique_violation';
  end if;

  insert into employees(auth_uid, firm_id, full_name, email, role, status)
  values (auth_user_id, target_firm_id, normalized_name, normalized_email, 'lawyer', 'active')
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role)
  values (auth_user_id, target_firm_id, new_employee_id, normalized_name, normalized_email, 'lawyer');

  -- sync_lawyer_profile trigger may have already inserted; keep idempotent
  insert into lawyers(employee_id)
  values (new_employee_id)
  on conflict (employee_id) do nothing;

  return target_firm_id;
end;
$$;

-- ─── 2) Office admin provisioning — bypass RLS during auth signup ────────────

create or replace function create_office_admin_profile(
  auth_user_id uuid,
  office_name text,
  owner_name text,
  owner_email text,
  owner_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_firm_id uuid;
  new_employee_id uuid;
  normalized_email text := lower(trim(owner_email));
  normalized_name text := trim(owner_name);
begin
  perform set_config('row_security', 'off', true);

  if char_length(normalized_name) < 2 then
    raise exception 'Owner name must be at least 2 characters'
      using errcode = 'check_violation';
  end if;

  insert into firms(name, owner_full_name, email, phone, plan)
  values (office_name, normalized_name, normalized_email, owner_phone, 'free')
  returning id into new_firm_id;

  insert into employees(auth_uid, firm_id, full_name, email, phone, role, status)
  values (auth_user_id, new_firm_id, normalized_name, normalized_email, owner_phone, 'admin', 'active')
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role, phone)
  values (auth_user_id, new_firm_id, new_employee_id, normalized_name, normalized_email, 'admin', owner_phone);

  return new_firm_id;
end;
$$;

-- ─── 3) Sync trigger — security definer + idempotent ─────────────────────────

create or replace function sync_lawyer_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);

  if new.role = 'lawyer' and new.status = 'active' and new.deleted_at is null then
    insert into lawyers (employee_id)
    values (new.id)
    on conflict (employee_id) do nothing;
  elsif tg_op = 'UPDATE' and old.role = 'lawyer' and new.role <> 'lawyer' then
    delete from lawyers where employee_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_lawyer_profile on employees;
create trigger trg_sync_lawyer_profile
  after insert or update of role, status, deleted_at on employees
  for each row execute function sync_lawyer_profile();

-- ─── 4) Auth signup handler ──────────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  flow text;
  invite_token text;
begin
  perform set_config('row_security', 'off', true);

  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  flow := lower(trim(coalesce(meta->>'registration_flow', '')));
  invite_token := nullif(trim(coalesce(meta->>'invitation_token', '')), '');

  if flow = 'office' then
    perform create_office_admin_profile(
      new.id,
      coalesce(nullif(trim(meta->>'office_name'), ''), nullif(trim(meta->>'company'), ''), 'مكتب محاماة'),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      nullif(trim(meta->>'phone'), '')
    );
    return new;
  end if;

  if flow = 'lawyer' then
    perform create_lawyer_profile(
      new.id,
      coalesce(nullif(trim(meta->>'firm_code'), ''), nullif(trim(meta->>'office_code'), ''), ''),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  if flow = 'invite' and invite_token is not null then
    perform create_invited_profile(
      new.id,
      invite_token,
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  perform create_office_admin_profile(
    new.id,
    coalesce(nullif(trim(meta->>'company'), ''), 'مكتب محاماة'),
    coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(trim(meta->>'phone'), '')
  );
  return new;
exception
  when others then
    raise exception 'Signup provisioning failed: %', sqlerrm
      using errcode = sqlstate;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─── 5) Pre-signup email availability (client validation) ────────────────────

create or replace function is_email_available_for_registration(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from profiles p
    where lower(p.email) = lower(trim(check_email)) and p.deleted_at is null
  )
  and not exists (
    select 1 from employees e
    where lower(e.email) = lower(trim(check_email)) and e.deleted_at is null
  );
$$;

grant execute on function is_email_available_for_registration(text) to anon, authenticated;

-- ─── 6) Ensure signup RLS policies exist ─────────────────────────────────────

drop policy if exists "employees_insert_own" on employees;
create policy "employees_insert_own" on employees for insert
  with check (auth_uid = auth.uid());

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert
  with check (id = auth.uid());

drop policy if exists "lawyers_insert_self" on lawyers;
create policy "lawyers_insert_self" on lawyers for insert
  with check (
    exists (
      select 1 from employees e
      where e.id = employee_id
        and e.auth_uid = auth.uid()
        and e.deleted_at is null
    )
  );
