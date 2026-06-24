-- LegalMind Yemen — Clear Security Advisor lint 0028 (anon + SECURITY DEFINER)
-- Run after 081_security_advisor_function_hardening.sql
--
-- Strategy:
--   1) Revoke anon/PUBLIC execute on every public SECURITY DEFINER routine
--   2) Re-expose pre-auth flows via SECURITY INVOKER + narrow RLS / views
--   3) Keep DEFINER only for token/email checks that cannot use broad anon SELECT

-- ─── 0) Future functions: no automatic broad execute grants ───────────────
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- ─── 1) Shared helpers (INVOKER, safe for anon) ───────────────────────────
create or replace function public.normalize_firm_code(raw text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select regexp_replace(upper(replace(coalesce(raw, ''), ' ', '')), '-+', '-', 'g');
$$;

create or replace view public.firms_registration_public
with (security_invoker = true) as
select
  f.id,
  f.name,
  f.firm_code::text as firm_code
from public.firms f
where f.deleted_at is null
  and f.firm_code is not null;

grant select on public.firms_registration_public to anon, authenticated;

-- ─── 2) Revoke anon/PUBLIC from all public SECURITY DEFINER functions ───────
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
  loop
    begin
      execute format('revoke all on function %s from public', fn.signature);
      execute format('revoke all on function %s from anon', fn.signature);
    exception when others then
      raise notice 'revoke skip: %', fn.signature;
    end;
  end loop;
end $$;

-- ─── 3) Registration firm lookup → SECURITY INVOKER ────────────────────────
create or replace function public.get_office_by_firm_code(firm_code_input text)
returns table(id uuid, name text, firm_code text)
language sql
stable
security invoker
set search_path = public
as $$
  select f.id, f.name, f.firm_code
  from public.firms_registration_public f
  where public.normalize_firm_code(f.firm_code) = public.normalize_firm_code(firm_code_input)
    and public.is_valid_firm_code_format(public.normalize_firm_code(firm_code_input))
  limit 1;
$$;

create or replace function public.get_office_by_code(office_code_input text)
returns table(id uuid, name text, office_code text, firm_code text)
language sql
stable
security invoker
set search_path = public
as $$
  select g.id, g.name, g.firm_code, g.firm_code
  from public.get_office_by_firm_code(office_code_input) g;
$$;

create or replace function public.office_code_exists(office_code_input text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.get_office_by_firm_code(office_code_input)
  );
$$;

-- Template roles only; firm resolved inside RPC (no direct firm_roles table scan by clients)
create or replace function public.get_firm_roles_for_registration(office_code_input text)
returns table(slug text, name text)
language sql
stable
security invoker
set search_path = public
as $$
  select fr.slug, fr.name
  from public.firm_roles fr
  join public.get_office_by_firm_code(office_code_input) g on g.id = fr.firm_id
  where fr.is_template = true
    and fr.slug <> 'firm_owner'
  order by
    case fr.slug
      when 'managing_lawyer' then 1
      when 'lawyer' then 2
      when 'legal_assistant' then 3
      when 'secretary' then 4
      when 'accountant' then 5
      else 99
    end,
    fr.name;
$$;

drop policy if exists firm_roles_anon_registration_read on public.firm_roles;
create policy firm_roles_anon_registration_read on public.firm_roles
  for select
  to anon, authenticated
  using (
    is_template = true
    and slug <> 'firm_owner'
    and exists (
      select 1
      from public.firms_registration_public f
      where f.id = firm_roles.firm_id
    )
  );

-- ─── 4) Platform bank details → SECURITY INVOKER ───────────────────────────
drop policy if exists platform_bank_details_select on public.platform_bank_details;
create policy platform_bank_details_select on public.platform_bank_details
  for select
  to anon, authenticated
  using (true);

create or replace function public.get_platform_bank_details()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'bankName', bank_name,
    'accountName', account_name,
    'accountNumber', coalesce(account_number, ''),
    'iban', iban,
    'note', coalesce(note, '')
  )
  from public.platform_bank_details
  where id = 1;
$$;

-- ─── 5) Testimonials → SECURITY INVOKER ───────────────────────────────────
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
security invoker
set search_path = public
as $$
  select
    t.id,
    t.author_name,
    t.author_role,
    t.body,
    t.stars::integer,
    t.created_at
  from public.public_testimonials t
  where t.status = 'approved'
  order by t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 24), 50));
$$;

drop policy if exists public_testimonials_insert_public on public.public_testimonials;
create policy public_testimonials_insert_public on public.public_testimonials
  for insert
  to anon, authenticated
  with check (
    status = 'approved'
    and char_length(trim(author_name)) >= 2
    and char_length(trim(author_role)) >= 2
    and char_length(trim(body)) between 10 and 600
    and stars between 1 and 5
  );

create or replace function public.submit_public_testimonial(
  p_author_name text,
  p_author_role text,
  p_body text,
  p_stars integer default 5
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := trim(p_author_name);
  v_role text := trim(p_author_role);
  v_body text := trim(p_body);
  v_stars integer := coalesce(p_stars, 5);
  v_firm_id uuid;
begin
  if char_length(v_name) < 2 then
    raise exception 'أدخل اسماً صحيحاً (حرفان على الأقل).';
  end if;
  if char_length(v_role) < 2 then
    raise exception 'أدخل المسمى أو المكتب (حرفان على الأقل).';
  end if;
  if char_length(v_body) < 10 then
    raise exception 'التعليق قصير جداً (10 أحرف على الأقل).';
  end if;
  if char_length(v_body) > 600 then
    raise exception 'التعليق طويل جداً (600 حرف كحد أقصى).';
  end if;
  if v_stars < 1 or v_stars > 5 then
    raise exception 'التقييم يجب أن يكون بين 1 و 5.';
  end if;

  if auth.uid() is not null then
    select p.firm_id into v_firm_id
    from public.profiles p
    where p.id = auth.uid();
  end if;

  insert into public.public_testimonials (
    author_name, author_role, body, stars, status, user_id, firm_id
  )
  values (v_name, v_role, v_body, v_stars, 'approved', auth.uid(), v_firm_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── 6) Security event log → SECURITY INVOKER ─────────────────────────────
drop policy if exists security_events_insert_anon on public.security_events;
create policy security_events_insert_anon on public.security_events
  for insert
  to anon
  with check (
    actor_auth_uid is null
    and firm_id is null
    and employee_id is null
    and severity in ('info', 'warning', 'high', 'critical')
  );

drop policy if exists security_events_insert_authenticated on public.security_events;
create policy security_events_insert_authenticated on public.security_events
  for insert
  to authenticated
  with check (
    actor_auth_uid is null or actor_auth_uid = auth.uid()
  );

create or replace function public.log_security_event(
  p_event_type text,
  p_severity text default 'info',
  p_metadata jsonb default '{}'::jsonb,
  p_user_agent text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_firm_id uuid;
  v_employee_id uuid;
  v_id uuid;
  v_recent integer;
  v_severity text := lower(trim(coalesce(p_severity, 'info')));
begin
  if p_event_type is null or trim(p_event_type) = '' then
    raise exception 'invalid_event_type';
  end if;

  if v_severity not in ('info', 'warning', 'high', 'critical') then
    v_severity := 'info';
  end if;

  if v_uid is not null then
    select count(*) into v_recent
    from public.security_events se
    where se.actor_auth_uid = v_uid
      and se.created_at > now() - interval '5 minutes';

    if v_recent >= 60 then
      return null;
    end if;

    v_firm_id := private.get_current_firm_id();
    v_employee_id := private.get_current_employee_id();
  end if;

  insert into public.security_events (
    firm_id, actor_auth_uid, employee_id, event_type, severity, user_agent, metadata
  )
  values (
    v_firm_id,
    v_uid,
    v_employee_id,
    lower(trim(p_event_type)),
    v_severity,
    nullif(trim(coalesce(p_user_agent, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── 7) Invitation preview + email check (no anon + SECURITY DEFINER) ─────

-- invitation_hash: internal helper only (INVOKER — digest only)
create or replace function public.invitation_hash(raw_token text)
returns text
language sql
immutable
security invoker
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(raw_token, ''), 'sha256'), 'hex');
$$;

revoke all on function public.invitation_hash(text) from public, anon;

-- Email availability: authenticated/service only (registration relies on auth.signUp errors)
create or replace function public.is_email_available_for_registration(check_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  normalized_email text := lower(trim(check_email));
  v_available boolean;
begin
  perform set_config('row_security', 'off', true);

  if normalized_email = '' then
    return false;
  end if;

  select not exists (
    select 1 from public.profiles p
    where lower(p.email) = normalized_email and p.deleted_at is null
  )
  and not exists (
    select 1 from public.employees e
    where lower(e.email) = normalized_email and e.deleted_at is null
  )
  into v_available;

  return coalesce(v_available, false);
end;
$$;

revoke all on function public.is_email_available_for_registration(text) from public, anon;
grant execute on function public.is_email_available_for_registration(text) to authenticated, service_role;

-- Token-scoped invitation read via session GUC (SECURITY INVOKER + narrow RLS)
drop policy if exists invitations_anon_preview_by_token on public.invitations;
create policy invitations_anon_preview_by_token on public.invitations
  for select
  to anon, authenticated
  using (
    status = 'pending'
    and expires_at > now()
    and token_hash = encode(
      extensions.digest(
        nullif(trim(current_setting('app.invitation_token', true)), ''),
        'sha256'
      ),
      'hex'
    )
  );

drop policy if exists firm_roles_invitation_preview on public.firm_roles;
create policy firm_roles_invitation_preview on public.firm_roles
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.invitations i
      where i.firm_role_id = firm_roles.id
        and i.status = 'pending'
        and i.expires_at > now()
        and i.token_hash = encode(
          extensions.digest(
            nullif(trim(current_setting('app.invitation_token', true)), ''),
            'sha256'
          ),
          'hex'
        )
    )
  );

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
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
begin
  if coalesce(trim(raw_token), '') = '' then
    return;
  end if;

  perform set_config('app.invitation_token', trim(raw_token), true);

  return query
    select
      i.id,
      i.firm_id,
      f.name as office_name,
      i.email,
      i.full_name,
      i.phone,
      i.role::text,
      coalesce(fr.name, i.role::text) as role_name,
      fr.slug as role_slug,
      i.status,
      i.expires_at
    from public.invitations i
    left join public.firms_registration_public f on f.id = i.firm_id
    left join public.firm_roles fr on fr.id = i.firm_role_id
    where i.token_hash = encode(extensions.digest(trim(raw_token), 'sha256'), 'hex')
      and i.status = 'pending'
      and i.expires_at > now()
    limit 1;
end;
$$;

-- ─── 8) Grant anon/authenticated only on INVOKER pre-auth RPCs + narrow DEFINER
do $$
declare
  grant_row record;
begin
  for grant_row in
    select *
    from (values
      ('public.normalize_firm_code(text)', 'anon, authenticated'),
      ('public.get_office_by_firm_code(text)', 'anon, authenticated'),
      ('public.get_office_by_code(text)', 'anon, authenticated'),
      ('public.office_code_exists(text)', 'anon, authenticated'),
      ('public.get_firm_roles_for_registration(text)', 'anon, authenticated'),
      ('public.is_valid_firm_code_format(text)', 'anon, authenticated'),
      ('public.get_platform_bank_details()', 'anon, authenticated'),
      ('public.list_approved_testimonials(integer)', 'anon, authenticated'),
      ('public.submit_public_testimonial(text, text, text, integer)', 'anon, authenticated'),
      ('public.log_security_event(text, text, jsonb, text)', 'anon, authenticated'),
      ('public.get_invitation_by_token(text)', 'anon, authenticated')
    ) as grants(function_signature, grantees)
  loop
    begin
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

-- ─── 9) Final sweep: no anon/PUBLIC execute on any SECURITY DEFINER routine ─
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
  loop
    begin
      execute format('revoke all on function %s from public', fn.signature);
      execute format('revoke all on function %s from anon', fn.signature);
    exception when others then
      raise notice 'final revoke skip: %', fn.signature;
    end;
  end loop;
end $$;
