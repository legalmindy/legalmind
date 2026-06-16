-- Fix: function digest(text, unknown) does not exist
-- invitation_hash uses pgcrypto digest() in extensions schema.
-- Run after 031_fix_pgcrypto_random_bytes.sql (or standalone — includes secure_random_bytes)

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

create or replace function public.secure_random_bytes(byte_count integer default 32)
returns bytea
language sql
volatile
security definer
set search_path = public, extensions
as $$
  select extensions.gen_random_bytes(byte_count);
$$;

revoke all on function public.secure_random_bytes(integer) from public;
grant execute on function public.secure_random_bytes(integer) to authenticated, service_role;

create or replace function public.invitation_hash(raw_token text)
returns text
language sql
immutable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(raw_token, 'sha256'), 'hex');
$$;

revoke all on function public.invitation_hash(text) from public;
grant execute on function public.invitation_hash(text) to authenticated, anon, service_role;

-- Ensure invitation RPCs still resolve hash + random helpers
create or replace function public.create_office_invitation(
  invite_email text,
  invite_role text,
  app_origin text default null,
  invite_full_name text default null,
  invite_phone text default null
)
returns table (id uuid, email text, role text, status text, expires_at timestamptz, invite_url text)
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  raw_token text;
  hashed_token text;
  new_invitation public.invitations%rowtype;
  base_url text;
  normalized_email text;
begin
  perform public.expire_old_invitations();

  if not (select private.is_firm_manager()) then
    raise exception 'Only firm admins can create invitations';
  end if;

  normalized_email := lower(trim(invite_email));

  if normalized_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
    raise exception 'invalid_email';
  end if;

  if invite_role not in ('lawyer', 'assistant') then
    raise exception 'Invalid role';
  end if;

  raw_token := encode(public.secure_random_bytes(32), 'hex');
  hashed_token := public.invitation_hash(raw_token);
  base_url := coalesce(nullif(trim(app_origin), ''), 'https://app.com');

  insert into public.invitations (
    firm_id, email, full_name, phone, role, status, token_hash, invited_by, expires_at, invite_url
  )
  values (
    private.get_current_firm_id(),
    normalized_email,
    nullif(trim(invite_full_name), ''),
    nullif(trim(invite_phone), ''),
    invite_role::public.employee_role_enum,
    'pending',
    hashed_token,
    private.get_current_employee_id(),
    now() + interval '7 days',
    base_url || '/invite/' || raw_token
  )
  returning * into new_invitation;

  return query
  select
    new_invitation.id,
    new_invitation.email,
    new_invitation.role::text,
    new_invitation.status,
    new_invitation.expires_at,
    new_invitation.invite_url;
end;
$$;

drop function if exists public.get_invitation_by_token(text);

create or replace function public.get_invitation_by_token(raw_token text)
returns table (
  id uuid,
  firm_id uuid,
  office_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    i.id,
    i.firm_id,
    f.name as office_name,
    i.email,
    i.role::text,
    i.status,
    i.expires_at
  from public.invitations i
  join public.firms f on f.id = i.firm_id
  where i.token_hash = public.invitation_hash(raw_token)
    and i.status = 'pending'
    and i.expires_at > now()
  limit 1;
$$;

revoke all on function public.create_office_invitation(text, text, text, text, text) from public;
grant execute on function public.create_office_invitation(text, text, text, text, text) to authenticated;

revoke all on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
