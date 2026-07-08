-- 097: Fix anon "permission denied for table firms" on invite preview + office-code lookup
--
-- Root cause:
--   • 082 created public.firms_registration_public WITH (security_invoker = true).
--     A security_invoker view evaluates base-table access as the CALLING role.
--   • 086 ran `revoke all on table public.firms from anon`.
--   Result: anon can no longer read through the view, so every pre-auth flow that
--   depends on it breaks with 42501 "permission denied for table firms":
--     - get_invitation_by_token  (invite link preview page)   → 401
--     - get_office_by_firm_code / get_office_by_code           → firm-code lookup
--     - get_firm_roles_for_registration                       → role list
--     - firm_roles anon RLS policies (EXISTS on the view)
--
-- Fix (aligned with 086's stated intent "registration uses the narrow view"):
--   Turn firms_registration_public into a BARRIER VIEW (security_invoker = false),
--   so base-table access runs with the view owner's rights. anon only needs SELECT
--   on the view, not on public.firms. The view still exposes just the safe public
--   projection (id, name, firm_code) of non-deleted firms that have a firm_code.

create or replace view public.firms_registration_public
with (security_invoker = false) as
select
  f.id,
  f.name,
  f.firm_code::text as firm_code
from public.firms f
where f.deleted_at is null
  and f.firm_code is not null;

-- Re-assert read access on the narrow view (base firms table stays locked for anon).
grant select on public.firms_registration_public to anon, authenticated;

notify pgrst, 'reload schema';
