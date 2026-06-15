-- LegalMind Yemen — API embed fix, sync hardening, Supabase linter fixes
-- Run after 020_fix_sync_version_columns.sql

-- ─── 1) Harden sync RPC functions ────────────────────────────────────────────
-- Must DROP first: PostgreSQL rejects CREATE OR REPLACE when parameter names change.
drop function if exists public.sync_pull_table(text, text);

create function public.sync_pull_table(table_name text, since_cursor text default null)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sql text;
begin
  perform ensure_sync_table_allowed(table_name);

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = sync_pull_table.table_name
      and c.column_name = 'updated_at'
  ) then
    return;
  end if;

  sql := format(
    'select to_jsonb(t) from %I t
     where ($1 is null or $1 = '''' or t.updated_at > $1::timestamptz)
     order by t.updated_at asc
     limit 500',
    table_name
  );
  return query execute sql using since_cursor;
end;
$$;

create or replace function bump_sync_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sync_version := coalesce(old.sync_version, 0) + 1;
  new.updated_by := get_current_employee_id();
  if tg_op = 'UPDATE' and (new.updated_at is null or new.updated_at = old.updated_at) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ─── 2) Pin search_path on flagged helper functions ─────────────────────────
do $$
begin
  alter function public.generate_office_code() set search_path = public;
exception when undefined_function then null;
end $$;

do $$
begin
  alter function public.get_current_office_id() set search_path = public;
exception when undefined_function then null;
end $$;

-- ─── 3) Restrict provisioning RPCs (trigger-only, not client-callable) ───────
do $$
begin
  revoke all on function public.create_lawyer_profile(uuid, text, text, text) from public, anon, authenticated;
exception when undefined_function then null;
end $$;

do $$
begin
  revoke all on function public.create_office_admin_profile(uuid, text, text, text, text) from public, anon, authenticated;
exception when undefined_function then null;
end $$;

-- ─── 4) Avatars bucket: firm-scoped read (no public listing) ─────────────────
drop policy if exists "avatars_select_public" on storage.objects;

create policy "avatars_select_scoped" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (
        select 1
        from profiles viewer
        join profiles owner
          on owner.firm_id = viewer.firm_id
         and owner.deleted_at is null
        where viewer.id = auth.uid()
          and viewer.deleted_at is null
          and owner.id::text = (storage.foldername(name))[1]
      )
    )
  );

-- ─── 5) Re-grant sync RPC to authenticated ───────────────────────────────────
grant execute on function public.sync_pull_table(text, text) to authenticated;
grant execute on function public.sync_apply_event(text, text, uuid, uuid, text, jsonb) to authenticated;
