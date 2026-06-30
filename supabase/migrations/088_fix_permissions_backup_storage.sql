-- Fix execution request delete, table grants, billing admin alignment, backup storage bucket

-- ─── 1) execution_requests: grants + soft-delete RPC ─────────────────────────
grant select, insert, update on public.execution_requests to authenticated;

drop policy if exists "execution_requests_update" on public.execution_requests;

create policy "execution_requests_update" on public.execution_requests
  for update
  using (
    firm_id = (select private.get_current_firm_id())
    and deleted_at is null
    and (
      (select private.is_firm_subscription_active())
      or (select private.is_office_admin())
    )
  )
  with check (
    firm_id = (select private.get_current_firm_id())
  );

create or replace function public.delete_execution_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_firm_id uuid;
  v_affected int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_firm_id := private.get_current_firm_id();
  if v_firm_id is null then
    raise exception 'firm_not_found';
  end if;

  if not private.is_office_admin() then
    raise exception 'not_authorized';
  end if;

  update public.execution_requests
  set deleted_at = now(),
      updated_at = now()
  where id = p_request_id
    and firm_id = v_firm_id
    and deleted_at is null;

  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.delete_execution_request(uuid) from public;
grant execute on function public.delete_execution_request(uuid) to authenticated;

-- ─── 2) Billing admin: align profile super_admin with DB checks ──────────────
create or replace function private.is_billing_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select coalesce(
    (select private.get_current_role()) = 'super_admin'::public.employee_role_enum,
    false
  )
  or exists (
    select 1
    from private.platform_operators po
    where po.auth_uid = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text = 'super_admin'
      and exists (
        select 1
        from public.employees e
        where e.auth_uid = p.id
          and e.deleted_at is null
          and e.status = 'active'
      )
  );
$$;

create or replace function private.is_subscription_super_admin()
returns boolean
language sql
stable
security definer
set search_path = private, public, auth
as $$
  select private.is_billing_admin();
$$;

-- ─── 3) Public testimonials: ensure anon can call listing RPC ────────────────
revoke all on function public.list_approved_testimonials(int) from public;
grant execute on function public.list_approved_testimonials(int) to anon, authenticated;

revoke all on function public.submit_public_testimonial(text, text, text, int) from public;
grant execute on function public.submit_public_testimonial(text, text, text, int) to anon, authenticated;

-- ─── 4) Firm backup storage bucket (server-side backups) ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'firm-backups',
  'firm-backups',
  false,
  524288000,
  array['application/zip', 'application/octet-stream']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists firm_backups_storage_select on storage.objects;
create policy firm_backups_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'firm-backups'
    and (storage.foldername(name))[1] = (select private.get_current_firm_id()::text)
    and private.is_office_admin()
  );

drop policy if exists firm_backups_storage_insert on storage.objects;
create policy firm_backups_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'firm-backups'
    and (storage.foldername(name))[1] = (select private.get_current_firm_id()::text)
    and private.is_office_admin()
  );

-- Register server backup path on firm_backups row
alter table public.firm_backups
  add column if not exists storage_path text;

create or replace function public.register_firm_backup_storage(
  p_storage_path text,
  p_size_bytes bigint,
  p_file_count integer,
  p_tables_included text[] default '{}',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_firm_id uuid;
begin
  if not private.is_office_admin() then
    raise exception 'غير مصرح';
  end if;

  v_firm_id := private.get_current_firm_id();

  if p_storage_path is null
     or not (p_storage_path like v_firm_id::text || '/%') then
    raise exception 'invalid_storage_path';
  end if;

  insert into public.firm_backups (
    firm_id, created_by, size_bytes, file_count, tables_included, status, notes, storage_path
  )
  values (
    v_firm_id,
    private.get_current_employee_id(),
    coalesce(p_size_bytes, 0),
    coalesce(p_file_count, 0),
    coalesce(p_tables_included, '{}'),
    'completed',
    p_notes,
    p_storage_path
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_firm_backup_storage(text, bigint, integer, text[], text) from public;
grant execute on function public.register_firm_backup_storage(text, bigint, integer, text[], text) to authenticated;

create or replace function public.get_firm_backup_download_url(p_backup_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, private, storage
as $$
declare
  v_path text;
  v_firm_id uuid;
begin
  if not private.is_office_admin() then
    raise exception 'غير مصرح';
  end if;

  v_firm_id := private.get_current_firm_id();

  select b.storage_path into v_path
  from public.firm_backups b
  where b.id = p_backup_id
    and b.firm_id = v_firm_id
    and b.storage_path is not null;

  if v_path is null then
    raise exception 'backup_not_found';
  end if;

  return v_path;
end;
$$;

revoke all on function public.get_firm_backup_download_url(uuid) from public;
grant execute on function public.get_firm_backup_download_url(uuid) to authenticated;
