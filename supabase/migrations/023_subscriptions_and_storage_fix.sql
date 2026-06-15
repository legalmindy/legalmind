-- LegalMind Yemen — Subscription billing + avatar storage fix
-- Run after 022_lawyer_case_visibility.sql

-- ─── 1) Fix avatar upload: grant storage helper used by case-documents policies ─
create or replace function storage_case_id(object_name text)
returns uuid
language sql
immutable
security invoker
set search_path = public
as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$;

grant execute on function public.storage_case_id(text) to authenticated, anon;

-- Re-assert avatar bucket policies (021 may have removed public insert path)
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

create policy "avatars_insert_own" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars_update_own" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars_delete_own" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ─── 2) Firm subscription columns ─────────────────────────────────────────────
alter table firms add column if not exists subscription_status text
  not null default 'trial'
  check (subscription_status in ('trial', 'active', 'expired'));

alter table firms add column if not exists subscription_plan text
  not null default 'free'
  check (subscription_plan in ('free', 'professional', 'corporate'));

alter table firms add column if not exists subscription_expires_at timestamptz;

alter table firms add column if not exists is_locked boolean not null default false;

-- Backfill existing firms: 14-day trial if no expiry set
update firms
set
  subscription_status = coalesce(subscription_status, 'trial'),
  subscription_plan = case
    when plan in ('pro', 'professional') then 'professional'
    when plan in ('enterprise', 'firm', 'corporate') then 'corporate'
    else coalesce(subscription_plan, 'free')
  end,
  subscription_expires_at = coalesce(subscription_expires_at, created_at + interval '14 days'),
  is_locked = coalesce(is_locked, false)
where subscription_expires_at is null or subscription_plan is null;

-- ─── 3) Subscription payment requests ────────────────────────────────────────
create table if not exists subscription_requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  plan text not null check (plan in ('free', 'professional', 'corporate')),
  amount_yer numeric(12, 2) not null check (amount_yer >= 0),
  transfer_reference text not null check (char_length(trim(transfer_reference)) >= 3),
  receipt_path text not null,
  receipt_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscription_requests_firm on subscription_requests(firm_id, created_at desc);
create index if not exists idx_subscription_requests_status on subscription_requests(status);

drop trigger if exists set_updated_at_subscription_requests on subscription_requests;
create trigger set_updated_at_subscription_requests
  before update on subscription_requests
  for each row execute function set_updated_at();

-- ─── 4) Subscription receipts bucket ─────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subscription-receipts',
  'subscription-receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "subscription_receipts_select_firm" on storage.objects;
drop policy if exists "subscription_receipts_insert_firm" on storage.objects;

create policy "subscription_receipts_select_firm" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'subscription-receipts'
    and (storage.foldername(name))[1] = get_current_firm_id()::text
  );

create policy "subscription_receipts_insert_firm" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'subscription-receipts'
    and (storage.foldername(name))[1] = get_current_firm_id()::text
  );

-- ─── 5) Subscription access helpers ──────────────────────────────────────────
create or replace function is_firm_subscription_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        not f.is_locked
        and f.subscription_status in ('trial', 'active')
        and (f.subscription_expires_at is null or f.subscription_expires_at > now())
      from firms f
      where f.id = get_current_firm_id()
        and f.deleted_at is null
    ),
    false
  );
$$;

create or replace function sync_firm_subscription_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subscription_expires_at is not null
     and new.subscription_expires_at <= now()
     and new.subscription_status in ('trial', 'active') then
    new.subscription_status := 'expired';
    new.is_locked := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_firm_subscription_expiry on firms;
create trigger trg_sync_firm_subscription_expiry
  before insert or update of subscription_expires_at, subscription_status, is_locked on firms
  for each row execute function sync_firm_subscription_expiry();

-- Mark already-expired firms
update firms
set subscription_status = 'expired', is_locked = true
where subscription_expires_at is not null
  and subscription_expires_at <= now()
  and subscription_status in ('trial', 'active')
  and not is_locked;

-- ─── 6) RLS: subscription_requests ───────────────────────────────────────────
alter table subscription_requests enable row level security;

drop policy if exists "subscription_requests_select_firm" on subscription_requests;
create policy "subscription_requests_select_firm" on subscription_requests for select
  using (firm_id = get_current_firm_id());

drop policy if exists "subscription_requests_insert_manager" on subscription_requests;
create policy "subscription_requests_insert_firm" on subscription_requests for insert
  with check (
    firm_id = get_current_firm_id()
    and submitted_by = auth.uid()
  );

-- ─── 7) RLS: block data access when subscription inactive ────────────────────
-- Clients
drop policy if exists "clients_select_firm" on clients;
drop policy if exists "clients_insert_staff" on clients;
drop policy if exists "clients_update_staff" on clients;

create policy "clients_select_firm" on clients for select
  using (firm_id = get_current_firm_id() and deleted_at is null and is_firm_subscription_active());

create policy "clients_insert_staff" on clients for insert
  with check (
    firm_id = get_current_firm_id()
    and is_firm_subscription_active()
    and get_current_role() in ('super_admin','admin','firm_manager','assistant')
  );

create policy "clients_update_staff" on clients for update
  using (firm_id = get_current_firm_id() and is_firm_subscription_active())
  with check (firm_id = get_current_firm_id() and is_firm_subscription_active());

-- Cases
drop policy if exists "cases_select_role_scoped" on cases;
drop policy if exists "cases_insert_staff" on cases;
drop policy if exists "cases_update_role_scoped" on cases;

create policy "cases_select_role_scoped" on cases for select
  using (
    is_firm_subscription_active()
    and firm_id = get_current_firm_id()
    and deleted_at is null
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (get_current_role() = 'lawyer' and assigned_lawyer_id is not null and assigned_lawyer_id = get_current_lawyer_id())
    )
  );

create policy "cases_insert_staff" on cases for insert
  with check (
    is_firm_subscription_active()
    and firm_id = get_current_firm_id()
    and (
      get_current_role() in ('super_admin', 'admin', 'firm_manager', 'assistant')
      or (get_current_role() = 'lawyer' and (assigned_lawyer_id is null or assigned_lawyer_id = get_current_lawyer_id()))
    )
  );

create policy "cases_update_role_scoped" on cases for update
  using (
    is_firm_subscription_active()
    and firm_id = get_current_firm_id()
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (get_current_role() = 'lawyer' and assigned_lawyer_id is not null and assigned_lawyer_id = get_current_lawyer_id())
    )
  )
  with check (
    is_firm_subscription_active()
    and firm_id = get_current_firm_id()
    and (
      is_office_admin()
      or get_current_role() = 'assistant'
      or (get_current_role() = 'lawyer' and assigned_lawyer_id is not null and assigned_lawyer_id = get_current_lawyer_id())
    )
  );

-- Sessions (via case access)
drop policy if exists "sessions_select_case_access" on sessions;
drop policy if exists "sessions_insert_staff" on sessions;
drop policy if exists "sessions_update_staff" on sessions;

create policy "sessions_select_case_access" on sessions for select
  using (deleted_at is null and is_firm_subscription_active() and can_access_case(case_id));

create policy "sessions_insert_staff" on sessions for insert
  with check (
    is_firm_subscription_active()
    and can_access_case(case_id)
    and get_current_role() in ('super_admin','admin','firm_manager','assistant','lawyer')
  );

create policy "sessions_update_staff" on sessions for update
  using (is_firm_subscription_active() and can_access_case(case_id))
  with check (is_firm_subscription_active() and can_access_case(case_id));

-- Documents
drop policy if exists "documents_select_case_access" on documents;
drop policy if exists "documents_insert_case_access" on documents;
drop policy if exists "documents_update_case_access" on documents;

create policy "documents_select_case_access" on documents for select
  using (deleted_at is null and is_firm_subscription_active() and can_access_case(case_id));

create policy "documents_insert_case_access" on documents for insert
  with check (is_firm_subscription_active() and can_access_case(case_id));

create policy "documents_update_case_access" on documents for update
  using (is_firm_subscription_active() and can_access_case(case_id))
  with check (is_firm_subscription_active() and can_access_case(case_id));

-- Firms: members can always read their firm (needed for subscription UI)
drop policy if exists "firms_select_member" on firms;
create policy "firms_select_member" on firms for select
  using (
    id in (
      select firm_id from profiles where id = auth.uid() and deleted_at is null
      union
      select firm_id from employees where auth_uid = auth.uid() and deleted_at is null
    )
  );

grant execute on function public.is_firm_subscription_active() to authenticated;
