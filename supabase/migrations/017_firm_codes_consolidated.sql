-- LegalMind Yemen — Firm Code system (consolidated production pass)
-- Idempotent. Safe after 007, 013, 014, 015.
-- Format: ABC-1234 (uppercase, 8 chars, globally unique)

create extension if not exists "pgcrypto";

-- ─── 1. Schema ───────────────────────────────────────────────────────────────

alter table firms add column if not exists firm_code varchar(12);

create unique index if not exists firms_firm_code_unique_idx on firms(firm_code);
create index if not exists idx_firms_code on firms(firm_code);

create or replace function is_valid_firm_code_format(code text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(code, '') ~ '^[A-Z]{3}-[0-9]{4}$';
$$;

alter table firms drop constraint if exists firms_firm_code_format;
alter table firms add constraint firms_firm_code_format
  check (firm_code is null or is_valid_firm_code_format(firm_code));

-- ─── 2. Prefix from firm name (Latin + Arabic) ───────────────────────────────

create or replace function firm_code_prefix(firm_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  raw text := trim(coalesce(firm_name, ''));
  cleaned text;
  parts text[];
  prefix text := '';
  part text;
begin
  if raw = '' then
    return 'LMY';
  end if;

  -- Arabic / mixed names: keyword shortcuts then deterministic hash letters
  if raw ~ '[\u0600-\u06FF]' then
    if raw ~ 'عدال' then return 'ADL'; end if;
    if raw ~ 'يمن' then return 'YEM'; end if;
    if raw ~ 'قانون' then return 'LAW'; end if;
    if raw ~ 'عدل' then return 'ADL'; end if;
    if raw ~ 'حق' then return 'LAW'; end if;
    if raw ~ 'خبر' then return 'EXP'; end if;
  end if;

  cleaned := upper(regexp_replace(raw, '[^[:alnum:] ]', ' ', 'g'));
  parts := regexp_split_to_array(trim(cleaned), '\s+');

  foreach part in array parts loop
    if length(part) >= 3 then
      prefix := substr(regexp_replace(part, '[^A-Z0-9]', '', 'g'), 1, 3);
      exit;
    elsif length(part) > 0 then
      prefix := prefix || substr(regexp_replace(part, '[^A-Z0-9]', '', 'g'), 1, 1);
    end if;
  end loop;

  prefix := regexp_replace(coalesce(prefix, ''), '[^A-Z0-9]', '', 'g');

  if length(prefix) < 3 then
    prefix := upper(substr(encode(sha256(raw::bytea), 'hex'), 1, 3));
    prefix := translate(prefix, '0123456789', 'ABCDEFGHIJ');
  end if;

  return substr(rpad(prefix, 3, 'X'), 1, 3);
end;
$$;

-- ─── 3. Collision-safe generation ────────────────────────────────────────────

create or replace function generate_firm_code(firm_name text)
returns varchar
language plpgsql
volatile
set search_path = public
as $$
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
    exit when not exists (
      select 1 from firms where firm_code = candidate and deleted_at is null
    );
  end loop;

  return candidate;
end;
$$;

-- ─── 4. Trigger (auto-generate on INSERT) ────────────────────────────────────

create or replace function set_firm_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('legalmind_yemen_firm_code_generation'));

  if tg_op = 'INSERT' then
    if new.firm_code is null or trim(new.firm_code) = '' then
      new.firm_code := generate_firm_code(new.name);
    else
      new.firm_code := upper(trim(new.firm_code));
      if not is_valid_firm_code_format(new.firm_code) then
        raise exception 'Invalid firm code format. Expected ABC-1234.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
exception when unique_violation then
  new.firm_code := generate_firm_code(new.name);
  return new;
end;
$$;

drop trigger if exists trg_set_firm_code on firms;
create trigger trg_set_firm_code
  before insert on firms
  for each row execute function set_firm_code();

-- Backfill missing / invalid codes
do $$
declare
  firm_row record;
  code varchar(12);
begin
  for firm_row in
    select id, name, firm_code
    from firms
    where deleted_at is null
      and (firm_code is null or not is_valid_firm_code_format(firm_code))
  loop
    code := generate_firm_code(firm_row.name);
    update firms set firm_code = code where id = firm_row.id;
  end loop;
end $$;

alter table firms alter column firm_code set not null;

-- ─── 5. Public lookup RPCs (SECURITY DEFINER — no table scan for anon) ───────

drop function if exists get_office_by_firm_code(text);
create function get_office_by_firm_code(firm_code_input text)
returns table(id uuid, name text, firm_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized text := upper(trim(firm_code_input));
begin
  if not is_valid_firm_code_format(normalized) then
    return;
  end if;

  return query
  select f.id, f.name, f.firm_code::text
  from firms f
  where upper(f.firm_code) = normalized
    and f.deleted_at is null
  limit 1;
end;
$$;

drop function if exists get_office_by_code(text);
create function get_office_by_code(office_code_input text)
returns table(id uuid, name text, office_code text, firm_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select g.id, g.name, g.firm_code, g.firm_code
  from get_office_by_firm_code(office_code_input) g;
end;
$$;

create or replace function office_code_exists(office_code_input text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from get_office_by_firm_code(office_code_input));
$$;

-- ─── 6. Harden lawyer registration firm-code validation ──────────────────────

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

  insert into lawyers(employee_id)
  values (new_employee_id)
  on conflict (employee_id) do nothing;

  return target_firm_id;
end;
$$;

-- ─── 7. Grants ───────────────────────────────────────────────────────────────

grant execute on function get_office_by_firm_code(text) to anon, authenticated;
grant execute on function get_office_by_code(text) to anon, authenticated;
grant execute on function office_code_exists(text) to anon, authenticated;
grant execute on function is_valid_firm_code_format(text) to anon, authenticated;

revoke all on function generate_firm_code(text) from public;
revoke all on function set_firm_code() from public;
revoke all on function firm_code_prefix(text) from public;
