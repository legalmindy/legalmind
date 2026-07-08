-- 100: Clear "Security Definer View" advisor (lint 0010) on firms_registration_public
--
-- 097 made the view SECURITY DEFINER (security_invoker = false) so anon could read
-- it after 086 revoked anon access to public.firms. The Security Advisor flags
-- definer views. Restore the SECURITY INVOKER view (advisor-clean) and give anon
-- the minimum it needs to read through it:
--   • a COLUMN-scoped SELECT grant on public.firms (only id, name, firm_code)
--   • a restrictive RLS policy so anon rows are limited to non-deleted firms
--     that expose a registration code
-- This matches the original 083 design (pre-086) and exposes nothing more than
-- the narrow registration projection the invite / office-code flows already use.

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

-- Column-scoped base grant: anon can read ONLY the safe registration columns.
grant select (id, name, firm_code) on public.firms to anon;

-- Row filter: anon may only see firms that publish a registration code.
drop policy if exists firms_select_registration on public.firms;
create policy firms_select_registration on public.firms
  for select
  to anon
  using (deleted_at is null and firm_code is not null);

notify pgrst, 'reload schema';
