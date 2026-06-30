-- QA audit fixes: close firms anon enumeration + block orphan signups

-- ─── 1) Revoke direct anon SELECT on firms (use view + RPCs only) ───────────
drop policy if exists "firms_select_registration" on public.firms;

revoke all on table public.firms from anon;

-- Authenticated members still use firms_select; registration uses the narrow view.
grant select on public.firms_registration_public to anon, authenticated;

-- ─── 2) Reject signups without an approved registration flow ─────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  meta jsonb;
  flow text;
  invite_token text;
  role_slug text;
begin
  perform set_config('row_security', 'off', true);

  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  flow := lower(trim(coalesce(meta->>'registration_flow', '')));
  invite_token := nullif(trim(coalesce(meta->>'invitation_token', '')), '');
  role_slug := nullif(trim(coalesce(meta->>'firm_role_slug', '')), '');

  if flow = 'office' then
    perform public.create_office_admin_profile(
      new.id,
      coalesce(nullif(trim(meta->>'office_name'), ''), nullif(trim(meta->>'company'), ''), 'مكتب محاماة'),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      nullif(trim(meta->>'phone'), '')
    );
    return new;
  end if;

  if flow in ('lawyer', 'office_member') then
    perform public.create_office_member_profile(
      new.id,
      coalesce(nullif(trim(meta->>'firm_code'), ''), nullif(trim(meta->>'office_code'), ''), ''),
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      coalesce(role_slug, 'lawyer')
    );
    return new;
  end if;

  if flow = 'invite' and invite_token is not null then
    perform public.create_invited_profile(
      new.id,
      invite_token,
      coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email
    );
    return new;
  end if;

  raise exception 'registration_not_allowed'
    using hint = 'Use office registration, firm code, or invitation link.';
exception
  when others then
    raise exception 'Signup provisioning failed: %', sqlerrm using errcode = sqlstate;
end;
$$;
