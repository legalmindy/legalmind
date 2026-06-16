-- Migration 039: Make firm-code lookup robust against whitespace & missing codes
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem A: get_office_by_firm_code only does trim() on the input.
--   If the stored code has no spaces but the user pastes "XXX - 4541" with
--   inner spaces, the JS normalizeFirmCode strips them to "XXX-4541" first —
--   so that is fine.  BUT if the stored code itself has stray spaces (e.g.
--   backfilled incorrectly), the upper() comparison fails silently.
--
-- Problem B: Offices created before migration 017 may have NULL firm_code.
--   The backfill loop in 017 ran at migration time; any office created after
--   an incomplete migration is skipped.
--
-- Fix A: Normalise BOTH sides in the comparison (strip all whitespace).
-- Fix B: Re-run backfill for any firms that still have NULL / invalid codes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A. Robust normalizer helper ─────────────────────────────────────────────
create or replace function private.normalize_firm_code(raw text)
returns text
language sql immutable
set search_path = public
as $$
  -- Upper-case, strip ALL whitespace, collapse multiple dashes to one
  select regexp_replace(upper(replace(coalesce(raw, ''), ' ', '')), '-+', '-', 'g');
$$;

-- ─── A. Recreate lookup functions with normalised comparison ─────────────────

create or replace function get_office_by_firm_code(firm_code_input text)
returns table(id uuid, name text, firm_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized text := private.normalize_firm_code(firm_code_input);
begin
  if not is_valid_firm_code_format(normalized) then
    return;
  end if;

  return query
  select f.id, f.name, f.firm_code::text
  from firms f
  where private.normalize_firm_code(f.firm_code) = normalized
    and f.deleted_at is null
  limit 1;
end;
$$;

-- get_office_by_code delegates to get_office_by_firm_code — no change needed,
-- but recreate to ensure it picks up the updated helper.
create or replace function get_office_by_code(office_code_input text)
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

-- Re-grant execute (safe to repeat)
grant execute on function get_office_by_firm_code(text) to anon, authenticated;
grant execute on function get_office_by_code(text)      to anon, authenticated;
grant execute on function office_code_exists(text)      to anon, authenticated;

-- ─── B. Backfill: ensure every active firm has a valid firm_code ─────────────
do $$
declare
  firm_row record;
  code     varchar(8);
  attempts int;
begin
  for firm_row in
    select id, name from firms
    where deleted_at is null
      and (
        firm_code is null
        or trim(firm_code) = ''
        or not is_valid_firm_code_format(upper(trim(firm_code)))
      )
  loop
    attempts := 0;
    loop
      attempts := attempts + 1;
      -- Generate a code from the firm name (same logic as migration 017)
      select generate_firm_code(firm_row.name) into code;
      -- Ensure uniqueness
      exit when not exists (select 1 from firms where upper(firm_code) = upper(code));
      exit when attempts >= 20;
    end loop;
    update firms set firm_code = code where id = firm_row.id;
    raise notice 'Backfilled firm_code % for firm %', code, firm_row.id;
  end loop;
end $$;
