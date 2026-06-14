-- LegalMind Yemen - Complete firm invitation system

create extension if not exists "pgcrypto";

-- Profile helpers required by invitation RPCs and RLS (idempotent if 004 already ran)
do $$ begin
  create type profile_role_enum as enum ('admin','lawyer','assistant');
exception when duplicate_object then null; end $$;

create or replace function get_current_profile_role()
returns profile_role_enum as $$
  select role from profiles where id = auth.uid() and deleted_at is null limit 1;
$$ language sql stable security definer;

create or replace function is_office_profile_admin()
returns boolean as $$
  select coalesce(get_current_profile_role() = 'admin', false);
$$ language sql stable security definer;

create or replace function get_current_firm_id()
returns uuid as $$
  select coalesce(
    (select firm_id from profiles where id = auth.uid() and deleted_at is null limit 1),
    (select firm_id from employees where auth_uid = auth.uid() and deleted_at is null limit 1)
  );
$$ language sql stable security definer;

alter table invitations add column if not exists invite_url text;
alter table invitations add column if not exists resent_at timestamptz;
alter table invitations add column if not exists cancelled_at timestamptz;

alter table invitations drop constraint if exists invitations_status_check;
alter table invitations add constraint invitations_status_check
  check (status in ('pending','accepted','expired','cancelled'));

alter table invitations drop constraint if exists invitations_role_check;
alter table invitations add constraint invitations_role_check
  check (role in ('lawyer','assistant'));

create index if not exists idx_invitations_firm_status on invitations(firm_id, status);
create index if not exists idx_invitations_firm_email on invitations(firm_id, lower(email));

create or replace function invitation_hash(raw_token text)
returns text as $$
  select encode(digest(raw_token, 'sha256'), 'hex');
$$ language sql immutable security definer;

create or replace function expire_old_invitations()
returns void as $$
begin
  update invitations
  set status = 'expired'
  where status = 'pending'
    and expires_at <= now();
end;
$$ language plpgsql security definer;

create or replace function create_office_invitation(
  invite_email text,
  invite_role text,
  app_origin text default null
)
returns table (
  id uuid,
  email text,
  role text,
  status text,
  expires_at timestamptz,
  invite_url text
) as $$
declare
  current_profile profiles%rowtype;
  raw_token text;
  hashed_token text;
  new_invitation invitations%rowtype;
  base_url text;
begin
  perform expire_old_invitations();

  select * into current_profile
  from profiles
  where profiles.id = auth.uid()
    and profiles.deleted_at is null;

  if not found or current_profile.role <> 'admin' then
    raise exception 'Only firm admins can create invitations';
  end if;

  if invite_role not in ('lawyer','assistant') then
    raise exception 'Invalid invitation role';
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');
  hashed_token := invitation_hash(raw_token);
  base_url := coalesce(nullif(trim(app_origin), ''), 'https://app.com');

  insert into invitations (
    firm_id,
    email,
    role,
    status,
    token_hash,
    invited_by,
    expires_at,
    invite_url
  )
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

  return query select new_invitation.id, new_invitation.email, new_invitation.role::text, new_invitation.status, new_invitation.expires_at, new_invitation.invite_url;
end;
$$ language plpgsql security definer;

create or replace function resend_office_invitation(invitation_id uuid, app_origin text default null)
returns table (
  id uuid,
  email text,
  role text,
  status text,
  expires_at timestamptz,
  invite_url text
) as $$
declare
  current_profile profiles%rowtype;
  inv invitations%rowtype;
  raw_token text;
  base_url text;
begin
  perform expire_old_invitations();

  select * into current_profile from profiles where profiles.id = auth.uid() and deleted_at is null;
  if not found or current_profile.role <> 'admin' then
    raise exception 'Only firm admins can resend invitations';
  end if;

  select * into inv from invitations where invitations.id = invitation_id for update;
  if not found or inv.firm_id <> current_profile.firm_id then
    raise exception 'Invitation not found';
  end if;

  if inv.status = 'accepted' then
    raise exception 'Accepted invitations cannot be resent';
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');
  base_url := coalesce(nullif(trim(app_origin), ''), 'https://app.com');

  update invitations
  set status = 'pending',
      token_hash = invitation_hash(raw_token),
      expires_at = now() + interval '7 days',
      resent_at = now(),
      cancelled_at = null,
      invite_url = base_url || '/invite/' || raw_token
  where invitations.id = invitation_id
  returning * into inv;

  return query select inv.id, inv.email, inv.role::text, inv.status, inv.expires_at, inv.invite_url;
end;
$$ language plpgsql security definer;

create or replace function cancel_office_invitation(invitation_id uuid)
returns void as $$
declare
  current_profile profiles%rowtype;
begin
  select * into current_profile from profiles where profiles.id = auth.uid() and deleted_at is null;
  if not found or current_profile.role <> 'admin' then
    raise exception 'Only firm admins can cancel invitations';
  end if;

  update invitations
  set status = 'cancelled',
      cancelled_at = now()
  where id = invitation_id
    and firm_id = current_profile.firm_id
    and status in ('pending','expired');
end;
$$ language plpgsql security definer;

-- Must drop first: migration 002 created this function with a different return shape.
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
  if not found then
    raise exception 'Firm not found';
  end if;

  insert into employees(auth_uid, firm_id, full_name, email, role, status)
  values (auth_user_id, target_firm.id, invited_name, inv.email, inv.role, 'active')
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, role)
  values (auth_user_id, inv.firm_id, new_employee_id, invited_name, inv.email, inv.role::text::profile_role_enum);

  update invitations
  set status = 'accepted',
      accepted_at = now(),
      employee_id = new_employee_id
  where id = inv.id;

  return inv.firm_id;
end;
$$ language plpgsql security definer;

alter table invitations enable row level security;

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
