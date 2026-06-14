-- LegalMind Yemen — Firm Code system (production hardening)
-- Format: ABC-1234 (3-letter prefix from firm name + 4 digits)
-- Idempotent: safe to re-run on databases that already applied 007.

create extension if not exists "pgcrypto";

alter table firms add column if not exists firm_code varchar(12);

create unique index if not exists firms_firm_code_unique_idx on firms(firm_code);

create or replace function firm_code_prefix(firm_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
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
  if length(prefix) < 3 then
    prefix := rpad(prefix, 3, 'X');
  end if;

  return substr(prefix, 1, 3);
end;
$$;

create or replace function is_valid_firm_code_format(code text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(code, '') ~ '^[A-Z]{3}-[0-9]{4}$';
$$;

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
    exit when not exists (select 1 from firms where firm_code = candidate);
  end loop;

  return candidate;
end;
$$;

create or replace function set_firm_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('legalmind_yemen_firm_code_generation'));

  if new.firm_code is null or trim(new.firm_code) = '' then
    new.firm_code := generate_firm_code(new.name);
  else
    new.firm_code := upper(trim(new.firm_code));
    if not is_valid_firm_code_format(new.firm_code) then
      raise exception 'Invalid firm code format. Expected ABC-1234.'
        using errcode = 'check_violation';
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

do $$
declare
  firm_row record;
  code varchar(12);
begin
  for firm_row in
    select id, name, firm_code
    from firms
    where firm_code is null
       or not is_valid_firm_code_format(firm_code)
  loop
    code := generate_firm_code(firm_row.name);
    update firms set firm_code = code where id = firm_row.id;
  end loop;
end $$;

alter table firms drop constraint if exists firms_firm_code_format;
alter table firms add constraint firms_firm_code_format
  check (firm_code is null or is_valid_firm_code_format(firm_code));

alter table firms alter column firm_code set not null;

-- Public lookup RPCs (SECURITY DEFINER — no direct firms table exposure to anon)
drop function if exists get_office_by_firm_code(text);
create function get_office_by_firm_code(firm_code_input text)
returns table(id uuid, name text, firm_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_valid_firm_code_format(upper(trim(firm_code_input))) then
    return;
  end if;

  return query
  select f.id, f.name, f.firm_code::text
  from firms f
  where upper(f.firm_code) = upper(trim(firm_code_input))
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
  select exists (
    select 1 from get_office_by_firm_code(office_code_input)
  );
$$;

grant execute on function get_office_by_firm_code(text) to anon, authenticated;
grant execute on function get_office_by_code(text) to anon, authenticated;
grant execute on function office_code_exists(text) to anon, authenticated;
