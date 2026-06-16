-- Migration 035: Fix lawyer case visibility & invited-profile metadata
-- ─────────────────────────────────────────────────────────────────────
-- Problem 1: When a lawyer creates a case without selecting themselves,
--   assigned_lawyer_id stays NULL → RLS hides the case from that lawyer.
-- Fix: BEFORE INSERT trigger auto-sets assigned_lawyer_id to the creating
--   lawyer's lawyers.id whenever the inserting user is a 'lawyer'.
--
-- Problem 2: create_invited_profile ignores name/phone stored on the
--   invitation row (added by migration 032). New users get blank phone.
-- Fix: Prefer inv.full_name / inv.phone from the invitation row, falling
--   back to the signup-form values that are passed in.
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1) Auto-assign lawyer on case INSERT ────────────────────────────

create or replace function private.auto_assign_lawyer_on_case_insert()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_lawyer_id uuid;
begin
  -- Only run when the inserting user is a 'lawyer' and no assignment was given
  if NEW.assigned_lawyer_id is not null then
    return NEW;
  end if;

  if (select private.get_current_role()) <> 'lawyer' then
    return NEW;
  end if;

  -- Lookup their lawyers.id via employees.auth_uid
  select l.id
    into v_lawyer_id
    from public.lawyers l
    join public.employees e on e.id = l.employee_id
   where e.auth_uid = auth.uid()
     and e.firm_id  = NEW.firm_id
     and e.deleted_at is null
   limit 1;

  if v_lawyer_id is not null then
    NEW.assigned_lawyer_id := v_lawyer_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_auto_assign_lawyer on public.cases;
create trigger trg_auto_assign_lawyer
  before insert on public.cases
  for each row
  execute function private.auto_assign_lawyer_on_case_insert();

comment on function private.auto_assign_lawyer_on_case_insert() is
  'Ensures a lawyer who creates a case is always the assigned lawyer so RLS SELECT allows them to see it.';

-- ─── 2) Fix create_invited_profile to use stored invitation metadata ──

create or replace function public.create_invited_profile(
  auth_user_id uuid,
  raw_token     text,
  invited_name  text,
  invited_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv             invitations%rowtype;
  target_firm     firms%rowtype;
  new_employee_id uuid;
  final_name      text;
  final_phone     text;
begin
  perform expire_old_invitations();

  select * into inv
    from invitations
   where token_hash = invitation_hash(raw_token)
   for update;

  if not found or inv.status <> 'pending' or inv.expires_at <= now() then
    raise exception 'Invitation is invalid or expired'
      using errcode = 'invalid_parameter_value';
  end if;

  if lower(inv.email) <> lower(invited_email) then
    raise exception 'Invitation email does not match'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into target_firm
    from firms
   where id = inv.firm_id
     and deleted_at is null;

  if not found then
    raise exception 'Firm not found'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Prefer stored invitation metadata (set by admin at invite time)
  final_name  := coalesce(nullif(trim(inv.full_name), ''), nullif(trim(invited_name), ''), split_part(inv.email, '@', 1));
  final_phone := coalesce(nullif(trim(inv.phone), ''), null);

  insert into employees(auth_uid, firm_id, full_name, email, phone, role, status)
  values (auth_user_id, target_firm.id, final_name, inv.email, final_phone, inv.role, 'active')
  returning id into new_employee_id;

  insert into profiles(id, firm_id, employee_id, full_name, email, phone, role)
  values (
    auth_user_id,
    inv.firm_id,
    new_employee_id,
    final_name,
    inv.email,
    final_phone,
    inv.role::text::profile_role_enum
  )
  on conflict (id) do update
    set firm_id     = excluded.firm_id,
        employee_id = excluded.employee_id,
        full_name   = excluded.full_name,
        email       = excluded.email,
        phone       = excluded.phone,
        role        = excluded.role,
        deleted_at  = null;

  update invitations
     set status      = 'accepted',
         accepted_at = now(),
         employee_id = new_employee_id
   where id = inv.id;

  return inv.firm_id;
end;
$$;

grant execute on function public.create_invited_profile(uuid, text, text, text) to authenticated;

comment on function public.create_invited_profile(uuid, text, text, text) is
  'Creates employee+profile for an invited user. Uses full_name/phone stored on the invitation row (set by admin) with fallback to the signup-form name.';
