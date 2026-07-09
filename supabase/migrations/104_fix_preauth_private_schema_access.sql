-- 104: Fix "permission denied for schema private" on pre-auth RPCs (42501 / 401)
--
-- Root cause:
--   Migration 103 exposed pre-auth RPCs as SECURITY INVOKER wrappers that call
--   private.*_svc. PostgreSQL requires USAGE on schema private for the CALLING
--   role (anon). anon has EXECUTE on the private functions but NOT schema USAGE
--   → 42501 "permission denied for schema private" (surfaced as 401 in PostgREST).
--
-- Fix:
--   Thin SECURITY DEFINER public wrappers delegate to private.*_svc as the
--   function owner (who has private schema access). anon/authenticated only need
--   EXECUTE on the public entrypoints — never USAGE on schema private.
--   Revoke direct client execute on private pre-auth svc helpers.

notify pgrst, 'reload schema';

-- ─── Public DEFINER gateways (anon-safe entrypoints) ─────────────────────────

create or replace function public.get_office_by_firm_code(firm_code_input text)
returns table(id uuid, name text, firm_code text)
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select * from private.get_office_by_firm_code_svc(firm_code_input);
$$;

create or replace function public.get_office_by_code(office_code_input text)
returns table(id uuid, name text, office_code text, firm_code text)
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select * from private.get_office_by_code_svc(office_code_input);
$$;

create or replace function public.office_code_exists(office_code_input text)
returns boolean
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select private.office_code_exists_svc(office_code_input);
$$;

create or replace function public.get_firm_roles_for_registration(office_code_input text)
returns table(slug text, name text)
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select * from private.get_firm_roles_for_registration_svc(office_code_input);
$$;

create or replace function public.get_invitation_by_token(raw_token text)
returns table (
  id uuid,
  firm_id uuid,
  office_name text,
  email text,
  full_name text,
  phone text,
  role text,
  role_name text,
  role_slug text,
  status text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select * from private.get_invitation_by_token_svc(raw_token);
$$;

create or replace function public.list_approved_testimonials(p_limit integer default 24)
returns table (
  id uuid,
  author_name text,
  author_role text,
  body text,
  stars integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, private
as $$
  select * from private.list_approved_testimonials_svc(p_limit);
$$;

-- ─── Grants: public entrypoints only for clients ─────────────────────────────
do $$
declare
  grant_row record;
begin
  for grant_row in
    select *
    from (values
      ('public.normalize_firm_code(text)', 'anon, authenticated'),
      ('public.is_valid_firm_code_format(text)', 'anon, authenticated'),
      ('public.get_office_by_firm_code(text)', 'anon, authenticated'),
      ('public.get_office_by_code(text)', 'anon, authenticated'),
      ('public.office_code_exists(text)', 'anon, authenticated'),
      ('public.get_firm_roles_for_registration(text)', 'anon, authenticated'),
      ('public.get_invitation_by_token(text)', 'anon, authenticated'),
      ('public.list_approved_testimonials(integer)', 'anon, authenticated'),
      ('public.submit_public_testimonial(text, text, text, integer)', 'anon, authenticated'),
      ('public.log_security_event(text, text, jsonb, text)', 'anon, authenticated'),
      ('public.get_platform_bank_details()', 'anon, authenticated')
    ) as grants(function_signature, grantees)
  loop
    begin
      execute format('revoke all on function %s from public', grant_row.function_signature);
      execute format(
        'grant execute on function %s to %s',
        grant_row.function_signature,
        grant_row.grantees
      );
    exception
      when undefined_function then
        raise notice 'Skipped missing function: %', grant_row.function_signature;
    end;
  end loop;
end $$;

-- Private svc helpers: not directly client-callable (DEFER gateway only)
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'private.get_office_by_firm_code_svc(text)',
    'private.get_office_by_code_svc(text)',
    'private.office_code_exists_svc(text)',
    'private.get_firm_roles_for_registration_svc(text)',
    'private.get_invitation_by_token_svc(text)',
    'private.list_approved_testimonials_svc(integer)'
  ]
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', sig);
      execute format('grant execute on function %s to service_role', sig);
    exception
      when undefined_function then
        raise notice 'Skipped missing function: %', sig;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
