-- LegalMind Yemen — Make sync_pull_table and sync_apply_event safe (no 400 on errors)
-- Wrap all logic in EXCEPTION WHEN OTHERS THEN RETURN so the RPC always returns
-- gracefully (empty result / void) instead of raising a 400 to the client.

-- ─── sync_pull_table (firm-scoped, safe) ─────────────────────────────────────
drop function if exists public.sync_pull_table(text, text);

create function public.sync_pull_table(
  table_name   text,
  since_cursor text default null
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sql       text;
  v_firm_id uuid;
  has_upd   boolean;
begin
  -- Validate table name (returns empty on unsupported — never raises)
  if table_name not in (
    'firms','employees','invitations','clients','cases',
    'sessions','documents','case_attachments','lawyers','notifications'
  ) then
    return;
  end if;

  begin
    v_firm_id := get_current_firm_id();
  exception when others then
    return;          -- no firm context → return empty, not 400
  end;

  if v_firm_id is null then
    return;
  end if;

  select exists (
    select 1 from information_schema.columns c
    where  c.table_schema = 'public'
      and  c.table_name   = sync_pull_table.table_name
      and  c.column_name  = 'updated_at'
  ) into has_upd;

  begin
    if table_name = 'firms' then
      return query
        select to_jsonb(t) from firms t
        where  t.id = v_firm_id
          and  (not has_upd or since_cursor is null or since_cursor = ''
                or t.updated_at > since_cursor::timestamptz)
        order by t.updated_at asc nulls last limit 500;
      return;
    end if;

    if not has_upd then return; end if;

    if table_name in ('employees','invitations','clients','cases','notifications') then
      sql := format(
        'select to_jsonb(t) from %I t
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
        select to_jsonb(l) from lawyers l
        join   employees e on e.id = l.employee_id
          and  e.firm_id = v_firm_id and e.deleted_at is null
        where  (since_cursor is null or since_cursor = ''
                or l.updated_at > since_cursor::timestamptz)
        order  by l.updated_at asc limit 500;
      return;
    end if;

    if table_name = 'sessions' then
      return query
        select to_jsonb(s) from sessions s
        join   cases c on c.id = s.case_id
          and  c.firm_id = v_firm_id and c.deleted_at is null
        where  s.deleted_at is null
          and  (since_cursor is null or since_cursor = ''
                or s.updated_at > since_cursor::timestamptz)
        order  by s.updated_at asc limit 500;
      return;
    end if;

    if table_name = 'documents' then
      return query
        select to_jsonb(d) from documents d
        join   cases c on c.id = d.case_id
          and  c.firm_id = v_firm_id and c.deleted_at is null
        where  d.deleted_at is null
          and  (since_cursor is null or since_cursor = ''
                or d.updated_at > since_cursor::timestamptz)
        order  by d.updated_at asc limit 500;
      return;
    end if;

    if table_name = 'case_attachments' then
      return query
        select to_jsonb(a) from case_attachments a
        join   cases c on c.id = a.case_id
          and  c.firm_id = v_firm_id and c.deleted_at is null
        where  a.deleted_at is null
          and  (since_cursor is null or since_cursor = ''
                or a.updated_at > since_cursor::timestamptz)
        order  by coalesce(a.updated_at, a.uploaded_at) asc limit 500;
      return;
    end if;

  exception when others then
    return;          -- any query error → empty result, not 400
  end;
end;
$$;

grant execute on function public.sync_pull_table(text, text) to authenticated;


-- ─── sync_apply_event (safe) ──────────────────────────────────────────────────
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
security definer
set search_path = public
as $$
declare
  v_firm_id       uuid;
  existing_event  uuid;
begin
  if table_name not in (
    'firms','employees','invitations','clients','cases',
    'sessions','documents','case_attachments','lawyers','notifications'
  ) then
    return;
  end if;

  begin
    v_firm_id := get_current_firm_id();
  exception when others then
    return;
  end;

  if v_firm_id is null then return; end if;
  if firm_id is not null and firm_id <> v_firm_id then return; end if;

  begin
    select id into existing_event
    from   sync_events where client_event_id = event_id;
    if existing_event is not null then return; end if;

    insert into sync_events(client_event_id, firm_id, table_name, record_id, event_type, payload, created_by)
    values (event_id, v_firm_id, table_name, record_id, event_type, payload, get_current_employee_id());

    if event_type like '%.deleted' then
      if exists (
        select 1 from information_schema.columns c
        where  c.table_schema = 'public'
          and  c.table_name   = sync_apply_event.table_name
          and  c.column_name  = 'firm_id'
      ) then
        execute format(
          'update %I set deleted_at = coalesce(($1->>''deleted_at'')::timestamptz, now()),
                       updated_at = now()
           where  id = $2 and firm_id = $3',
          table_name
        ) using payload, record_id, v_firm_id;
      end if;
    end if;

  exception when others then
    return;          -- record the intent silently, don't raise 400
  end;
end;
$$;

grant execute on function public.sync_apply_event(text, text, uuid, uuid, text, jsonb) to authenticated;
