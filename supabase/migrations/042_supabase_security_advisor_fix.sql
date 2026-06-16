-- LegalMind Yemen — Supabase Security Advisor: comprehensive RPC lockdown
-- Run after 041_fix_sync_pull_no_400.sql
--
-- Fixes:
--   • Public Can Execute SECURITY DEFINER Function  → revoke PUBLIC/anon, grant explicitly
--   • Signed-In Users Can Execute SECURITY DEFINER  → sync → SECURITY INVOKER; internal helpers → private only
--   • Function Search Path Mutable                  → pin search_path on trigger helpers
--
-- Dashboard (manual): Authentication → Password Security → Enable leaked password protection

-- ─── 1) Pin search_path on private trigger helpers ───────────────────────────
create or replace function private.touch_expenses_updated_at()
returns trigger
language plpgsql
set search_path = private, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Pin search_path on ALL remaining public + private functions (idempotent)
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, n.nspname as schema_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
  loop
    begin
      execute format(
        'alter function %s set search_path = %I, public',
        fn.signature,
        fn.schema_name
      );
    exception when others then
      raise notice 'search_path skip: %', fn.signature;
    end;
  end loop;
end $$;

-- ─── 2) Revoke default PUBLIC execute on every public RPC ────────────────────
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
  loop
    begin
      execute format('revoke all on function %s from public', fn.signature);
      execute format('revoke all on function %s from anon', fn.signature);
      execute format('revoke all on function %s from authenticated', fn.signature);
    exception when others then
      raise notice 'revoke skip: %', fn.signature;
    end;
  end loop;
end $$;

-- ─── 3) Sync RPCs → SECURITY INVOKER (RLS enforced, clears DEFINER lint) ─────
drop function if exists public.sync_pull_table(text, text);

create function public.sync_pull_table(
  table_name   text,
  since_cursor text default null
)
returns setof jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  sql       text;
  v_firm_id uuid;
  has_upd   boolean;
begin
  if table_name not in (
    'firms','employees','invitations','clients','cases',
    'sessions','documents','case_attachments','lawyers','notifications'
  ) then
    return;
  end if;

  begin
    v_firm_id := private.get_current_firm_id();
  exception when others then
    return;
  end;

  if v_firm_id is null then return; end if;

  select exists (
    select 1 from information_schema.columns c
    where  c.table_schema = 'public'
      and  c.table_name   = sync_pull_table.table_name
      and  c.column_name  = 'updated_at'
  ) into has_upd;

  begin
    if table_name = 'firms' then
      return query
        select to_jsonb(t) from public.firms t
        where  t.id = v_firm_id
          and  (not has_upd or since_cursor is null or since_cursor = ''
                or t.updated_at > since_cursor::timestamptz)
        order by t.updated_at asc nulls last limit 500;
      return;
    end if;

    if not has_upd then return; end if;

    if table_name in ('employees','invitations','clients','cases','notifications') then
      sql := format(
        'select to_jsonb(t) from public.%I t
         where  t.firm_id = $2
           and  ($1 is null or $1 = '''' or t.updated_at > $1::timestamptz)
         order  by t.updated_at asc limit 500',
        table_name
      );
      return query execute sql using since_cursor, v_firm_id;
      return;
    end if;

    if table_name = 'lawyers' then
      return query
        select to_jsonb(l) from public.lawyers l
        join   public.employees e on e.id = l.employee_id
          and  e.firm_id = v_firm_id and e.deleted_at is null
        where  (since_cursor is null or since_cursor = ''
                or l.updated_at > since_cursor::timestamptz)
        order  by l.updated_at asc limit 500;
      return;
    end if;

    if table_name = 'sessions' then
      return query
        select to_jsonb(s) from public.sessions s
        join   public.cases c on c.id = s.case_id
          and  c.firm_id = v_firm_id and c.deleted_at is null
        where  s.deleted_at is null
          and  (since_cursor is null or since_cursor = ''
                or s.updated_at > since_cursor::timestamptz)
        order  by s.updated_at asc limit 500;
      return;
    end if;

    if table_name = 'documents' then
      return query
        select to_jsonb(d) from public.documents d
        join   public.cases c on c.id = d.case_id
          and  c.firm_id = v_firm_id and c.deleted_at is null
        where  d.deleted_at is null
          and  (since_cursor is null or since_cursor = ''
                or d.updated_at > since_cursor::timestamptz)
        order  by d.updated_at asc limit 500;
      return;
    end if;

    if table_name = 'case_attachments' then
      return query
        select to_jsonb(a) from public.case_attachments a
        join   public.cases c on c.id = a.case_id
          and  c.firm_id = v_firm_id and c.deleted_at is null
        where  a.deleted_at is null
          and  (since_cursor is null or since_cursor = ''
                or a.updated_at > since_cursor::timestamptz)
        order  by coalesce(a.updated_at, a.uploaded_at) asc limit 500;
      return;
    end if;

  exception when others then
    return;
  end;
end;
$$;

create or replace function public.sync_apply_event(
  event_id   text,
  table_name text,
  record_id  uuid,
  firm_id    uuid,
  event_type text,
  payload    jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_firm_id      uuid;
  existing_event uuid;
begin
  if table_name not in (
    'firms','employees','invitations','clients','cases',
    'sessions','documents','case_attachments','lawyers','notifications'
  ) then
    return;
  end if;

  v_firm_id := private.get_current_firm_id();
  if v_firm_id is null then return; end if;
  if firm_id is not null and firm_id <> v_firm_id then return; end if;

  select id into existing_event
  from   public.sync_events where client_event_id = event_id;
  if existing_event is not null then return; end if;

  insert into public.sync_events(
    client_event_id, firm_id, table_name, record_id, event_type, payload, created_by
  )
  values (
    event_id, v_firm_id, table_name, record_id, event_type, payload,
    private.get_current_employee_id()
  );

  if event_type like '%.deleted' then
    if exists (
      select 1 from information_schema.columns c
      where  c.table_schema = 'public'
        and  c.table_name   = sync_apply_event.table_name
        and  c.column_name  = 'firm_id'
    ) then
      execute format(
        'update public.%I set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()),
                       updated_at = now()
         where  id = $2 and firm_id = $3',
        table_name
      ) using payload, record_id, v_firm_id;
    elsif table_name in ('sessions', 'documents') then
      execute format(
        'update public.%I t set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()),
                       updated_at = now()
         from public.cases c
         where t.id = $2 and c.id = t.case_id and c.firm_id = $3',
        table_name
      ) using payload, record_id, v_firm_id;
    end if;
  end if;
exception when others then
  return;
end;
$$;

-- is_platform_operator → INVOKER wrapper (no DEFINER lint)
create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.is_platform_operator();
$$;

-- ─── 4) Explicit GRANT matrix (whitelist only) ───────────────────────────────
do $$
declare
  grant_row record;
begin
  for grant_row in
    select *
    from (values
      -- Registration / pre-auth lookup (SECURITY DEFINER, intentional anon)
      ('public.get_office_by_code(text)',                         'anon, authenticated'),
      ('public.get_office_by_firm_code(text)',                    'anon, authenticated'),
      ('public.office_code_exists(text)',                         'anon, authenticated'),
      ('public.get_invitation_by_token(text)',                    'anon, authenticated'),
      ('public.is_email_available_for_registration(text)',        'anon, authenticated'),
      ('public.is_valid_firm_code_format(text)',                  'anon, authenticated'),

      -- Authenticated business RPCs (internal auth checks inside DEFINER bodies)
      ('public.get_current_profile_context()',                    'authenticated'),
      ('public.accept_invitation_for_auth_user(text)',            'authenticated'),
      ('public.create_office_invitation(text, text, text, text, text)', 'authenticated'),
      ('public.create_office_invitation(text, text, text)',       'authenticated'),
      ('public.cancel_office_invitation(uuid)',                   'authenticated'),
      ('public.resend_office_invitation(uuid, text)',             'authenticated'),
      ('public.delete_office_expense(uuid)',                      'authenticated'),
      ('public.is_platform_operator()',                           'authenticated'),
      ('public.review_subscription_request(uuid, text, text)',    'authenticated'),
      ('public.create_invited_profile(uuid, text, text, text)',   'authenticated'),
      ('public.sync_pull_table(text, text)',                      'authenticated'),
      ('public.sync_apply_event(text, text, uuid, uuid, text, jsonb)', 'authenticated'),
      ('public.subscription_plan_duration_days(text)',            'authenticated'),

      -- Cron / maintenance — service_role ONLY
      ('public.purge_old_audit_logs(integer)',                    'service_role'),
      ('public.purge_old_error_logs(integer)',                    'service_role'),
      ('public.purge_old_invitations(integer)',                   'service_role'),
      ('public.expire_stale_firm_subscriptions()',                'service_role'),

      -- Internal crypto helpers — NOT client-callable (used by DEFINER functions as owner)
      ('public.secure_random_bytes(integer)',                       'service_role'),
      ('public.invitation_hash(text)',                              'service_role')
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

-- Private helpers: authenticated needs EXECUTE for RLS policies only
do $$
declare sig text;
begin
  foreach sig in array array[
    'private.get_current_firm_id()',
    'private.get_current_employee_id()',
    'private.get_current_profile_role()',
    'private.get_current_role()',
    'private.get_current_lawyer_id()',
    'private.is_office_profile_admin()',
    'private.is_office_admin()',
    'private.is_firm_manager()',
    'private.is_current_user_office_admin()',
    'private.is_firm_subscription_active()',
    'private.can_access_case(uuid)',
    'private.storage_case_id(text)',
    'private.is_platform_operator()'
  ]
  loop
    begin
      execute format('revoke all on function %s from public', sig);
      execute format('revoke all on function %s from anon', sig);
      execute format('grant execute on function %s to authenticated, service_role', sig);
    exception when undefined_function then
      raise notice 'Skipped private helper: %', sig;
    end;
  end loop;
end $$;

-- Trigger helpers: never client-callable
do $$
declare sig text;
begin
  foreach sig in array array[
    'private.touch_expenses_updated_at()',
    'private.insert_audit_log()',
    'private.ensure_sync_table_allowed(text)'
  ]
  loop
    begin
      execute format('revoke all on function %s from public', sig);
      execute format('revoke all on function %s from anon', sig);
      execute format('revoke all on function %s from authenticated', sig);
    exception when undefined_function then null;
    end;
  end loop;
end $$;
