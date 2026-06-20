-- Document timeline auto-log + firm role permission updates for office manager

-- Timeline when documents are uploaded
create or replace function private.timeline_on_document()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_case_id uuid;
begin
  if tg_op = 'INSERT' and new.deleted_at is null then
    v_case_id := new.case_id;
    if v_case_id is not null then
      perform public.append_case_timeline_event(
        v_case_id,
        'document_uploaded',
        format('رفع مستند: %s', coalesce(new.title, 'مستند')),
        coalesce(new.category, ''),
        jsonb_build_object('document_id', new.id, 'title', new.title, 'category', new.category)
      );
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_timeline_document on public.documents;
create trigger trg_timeline_document
  after insert on public.documents
  for each row execute function private.timeline_on_document();

-- Timeline when case lawyer is reassigned
create or replace function private.timeline_on_case_lawyer_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lawyer_name text;
begin
  if tg_op = 'UPDATE'
     and new.assigned_lawyer_id is distinct from old.assigned_lawyer_id
     and new.deleted_at is null then
    select e.full_name into v_lawyer_name
    from public.lawyers l
    join public.employees e on e.id = l.employee_id
    where l.id = new.assigned_lawyer_id;

    perform public.append_case_timeline_event(
      new.id,
      'lawyer_assigned',
      coalesce(format('تعيين المحامي: %s', v_lawyer_name), 'إعادة توزيع القضية'),
      null,
      jsonb_build_object(
        'old_lawyer_id', old.assigned_lawyer_id,
        'new_lawyer_id', new.assigned_lawyer_id
      )
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_timeline_case_lawyer on public.cases;
create trigger trg_timeline_case_lawyer
  after update of assigned_lawyer_id on public.cases
  for each row execute function private.timeline_on_case_lawyer_change();

-- RPC: update firm role permissions (office manager)
create or replace function public.update_firm_role_permissions(
  p_role_id uuid,
  p_permissions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not (private.is_office_admin() or private.has_permission('users.permissions')) then
    raise exception 'not_authorized';
  end if;

  update public.firm_roles
  set permissions = coalesce(p_permissions, '{}'::jsonb),
      updated_at = now()
  where id = p_role_id
    and firm_id = private.get_current_firm_id();

  if not found then
    raise exception 'role_not_found';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.create_custom_firm_role(
  p_name text,
  p_slug text,
  p_permissions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_firm uuid := private.get_current_firm_id();
begin
  if not (private.is_office_admin() or private.has_permission('users.permissions')) then
    raise exception 'not_authorized';
  end if;

  insert into public.firm_roles (firm_id, name, slug, is_template, permissions)
  values (v_firm, trim(p_name), lower(trim(p_slug)), false, coalesce(p_permissions, '{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'role_id', v_id);
end;
$$;

revoke all on function public.update_firm_role_permissions(uuid, jsonb) from public;
grant execute on function public.update_firm_role_permissions(uuid, jsonb) to authenticated;
revoke all on function public.create_custom_firm_role(text, text, jsonb) from public;
grant execute on function public.create_custom_firm_role(text, text, jsonb) to authenticated;
