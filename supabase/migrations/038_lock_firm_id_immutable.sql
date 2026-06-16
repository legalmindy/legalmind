-- Migration 038: Lock firm_id as immutable on profiles and employees
-- ─────────────────────────────────────────────────────────────────────────────
-- CRITICAL BUG (Finding #1):
--   The profiles_update and employees_update RLS policies allow a user to
--   overwrite their own firm_id via:
--     supabase.from('profiles').update({ firm_id: '<office-b-uuid>' }).eq('id', myId)
--   Once firm_id changes, private.get_current_firm_id() returns Office B,
--   and RLS silently grants that user access to Office B's data.
--
-- Fix: BEFORE UPDATE trigger on both tables that raises an exception if
--   firm_id is changed, unless the caller is the service_role (migrations /
--   admin provisioning only).  No existing RPC needs to change firm_id at
--   runtime; all provisioning uses SECURITY DEFINER functions.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: reject firm_id re-assignment on profiles
create or replace function private.enforce_profile_firm_id_immutable()
returns trigger language plpgsql security definer
set search_path = public, private, auth as $$
begin
  -- Allow service_role to change firm_id (used by admin provisioning RPCs)
  if current_setting('role', true) = 'service_role' then
    return NEW;
  end if;
  if NEW.firm_id is distinct from OLD.firm_id then
    raise exception 'FIRM_ID_IMMUTABLE: firm_id cannot be changed after account creation'
      using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_profiles_firm_id_immutable on public.profiles;
create trigger trg_profiles_firm_id_immutable
  before update on public.profiles
  for each row execute function private.enforce_profile_firm_id_immutable();

-- Helper: reject firm_id re-assignment on employees
create or replace function private.enforce_employee_firm_id_immutable()
returns trigger language plpgsql security definer
set search_path = public, private, auth as $$
begin
  if current_setting('role', true) = 'service_role' then
    return NEW;
  end if;
  if NEW.firm_id is distinct from OLD.firm_id then
    raise exception 'FIRM_ID_IMMUTABLE: firm_id cannot be changed after account creation'
      using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_employees_firm_id_immutable on public.employees;
create trigger trg_employees_firm_id_immutable
  before update on public.employees
  for each row execute function private.enforce_employee_firm_id_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- Also tighten RLS WITH CHECK on profiles_update and employees_update to
-- ensure the new row keeps the same firm_id (double-lock: trigger + policy).
-- ─────────────────────────────────────────────────────────────────────────────

-- Re-create profiles_update with explicit firm_id immutability in WITH CHECK
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (
    deleted_at is null
    and (
      id = (select auth.uid())
      or (firm_id = (select private.get_current_firm_id()) and (select private.is_firm_manager()))
    )
  )
  with check (
    -- firm_id must be unchanged on self-updates; managers may update others
    -- in same firm but still cannot change firm_id (trigger enforces it too)
    firm_id = (select private.get_current_firm_id())
    and (
      id = (select auth.uid())
      or (select private.is_firm_manager())
    )
  );

-- Re-create employees_update with firm_id immutability
drop policy if exists "employees_update" on public.employees;
create policy "employees_update" on public.employees for update
  using (
    deleted_at is null
    and firm_id = (select private.get_current_firm_id())
    and (
      auth_uid = (select auth.uid())
      or (select private.is_office_admin())
    )
  )
  with check (
    firm_id = (select private.get_current_firm_id())
    and (
      auth_uid = (select auth.uid())
      or (select private.is_office_admin())
    )
  );
