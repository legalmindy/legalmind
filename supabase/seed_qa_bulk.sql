-- LegalMind Yemen — QA bulk seed (50 firms, 3000+ cases, thousands of related rows)
-- Run: npx supabase db query --linked -f supabase/seed_qa_bulk.sql
-- Idempotent: skips if QA firms already exist.

do $qa$
declare
  fi int;
  fid uuid;
  mgr_id uuid;
  emp_id uuid;
  lawyer_ids uuid[] := '{}';
  lawyer_row uuid;
  client_ids uuid[];
  case_rec record;
  pay_id uuid;
  v_year text := to_char(now(), 'YYYY');
  v_seq int;
begin
  if (select count(*) from public.firms where name like 'مكتب QA %') >= 50 then
    raise notice 'QA seed complete (50 firms) — skipping';
    return;
  end if;

  -- تعطيل محفزات السجل الزمني أثناء البذر الجماعي
  alter table public.sessions disable trigger trg_timeline_session;
  alter table public.case_payments disable trigger trg_timeline_case_payment;
  alter table public.documents disable trigger trg_timeline_document;

  delete from public.firms where name like 'مكتب QA %';

  for fi in 1..50 loop
    insert into public.firms (
      name, license_no, plan, subscription_status, subscription_plan,
      subscription_expires_at, is_locked
    )
    values (
      'مكتب QA ' || fi,
      'LIC-QA-' || lpad(fi::text, 3, '0'),
      'pro',
      'active',
      'annual',
      now() + interval '365 days',
      false
    )
    returning id into fid;

    perform public.seed_firm_role_templates(fid);

    -- مدير
    insert into public.employees (firm_id, full_name, email, phone, role, status)
    values (fid, 'مدير QA ' || fi, 'qa.mgr.f' || fi || '@legalmind-qa.test', '77' || lpad(fi::text, 7, '0'), 'firm_manager', 'active')
    returning id into mgr_id;

    -- 5 محامين
    lawyer_ids := '{}';
    for li in 1..5 loop
      insert into public.employees (firm_id, full_name, email, phone, role, status)
      values (
        fid,
        'محامي QA ' || fi || '-' || li,
        'qa.law.f' || fi || '.' || li || '@legalmind-qa.test',
        '73' || lpad((fi * 10 + li)::text, 7, '0'),
        'lawyer',
        'active'
      )
      returning id into emp_id;
      select l.id into lawyer_row from public.lawyers l where l.employee_id = emp_id;
      if lawyer_row is not null then
        lawyer_ids := array_append(lawyer_ids, lawyer_row);
      end if;
    end loop;

    -- 3 سكرتارية + 2 محاسب + 1 أرشيف (assistant)
    insert into public.employees (firm_id, full_name, email, phone, role, status)
    select
      fid,
      'سكرتير QA ' || fi || '-' || g,
      'qa.sec.f' || fi || '.' || g || '@legalmind-qa.test',
      '71' || lpad((fi * 10 + g)::text, 7, '0'),
      'assistant',
      'active'
    from generate_series(1, 3) g;

    insert into public.employees (firm_id, full_name, email, phone, role, status)
    select
      fid,
      'محاسب QA ' || fi || '-' || g,
      'qa.acc.f' || fi || '.' || g || '@legalmind-qa.test',
      '70' || lpad((fi * 10 + g)::text, 7, '0'),
      'assistant',
      'active'
    from generate_series(1, 2) g;

    insert into public.employees (firm_id, full_name, email, phone, role, status)
    values (fid, 'أرشيف QA ' || fi, 'qa.arc.f' || fi || '@legalmind-qa.test', '77' || lpad((500000 + fi)::text, 7, '0'), 'assistant', 'active');

    -- 12 عميلاً لكل مكتب (600 إجمالاً)
    insert into public.clients (firm_id, name, phone, type, email)
    select
      fid,
      'عميل QA ' || fi || '-' || g,
      '77' || lpad((fi * 100 + g)::text, 7, '0'),
      case when g % 3 = 0 then 'شركة تجارية' else 'فرد' end,
      'qa.cli.f' || fi || '.' || g || '@legalmind-qa.test'
    from generate_series(1, 12) g;

    select array_agg(id order by created_at) into client_ids
    from public.clients where firm_id = fid and deleted_at is null;

    -- 60 قضية لكل مكتب (3000 إجمالاً)
    insert into public.cases (
      firm_id, client_id, assigned_lawyer_id, court_case_number, title,
      case_type, case_stage, category, court, total_amount, paid_amount,
      status, contract_date, contract_currency, notes
    )
    select
      fid,
      client_ids[1 + ((g - 1) % array_length(client_ids, 1))],
      lawyer_ids[1 + ((g - 1) % array_length(lawyer_ids, 1))],
      'QA-' || fi || '-' || lpad(g::text, 5, '0'),
      'قضية QA ' || fi || ' #' || g,
      (array['مدنية','تجارية','أحوال شخصية','عمالية','مستعجلة','جنائية']::case_type_enum[])[1 + (g % 6)],
      (array['ابتدائي مدني','ابتدائي شخصي','ابتدائي جنائي','استئناف','نقض']::case_stage_enum[])[1 + (g % 5)],
      (array['تجاري','مدني','جنائي'])[1 + (g % 3)],
      (array['محكمة استئناف صنعاء','محكمة ابتدائية عدن','محكمة تعز'])[1 + (g % 3)],
      amt.tot,
      (amt.tot * random() * 0.35)::numeric(12,2),
      case when g % 10 = 0 then 'archived'::case_status_enum else 'active'::case_status_enum end,
      (current_date - (g * 3))::date,
      'YER',
      'ملاحظة QA على القضية ' || g
    from generate_series(1, 60) g
    cross join lateral (
      select (50000 + (random() * 400000))::numeric(12,2) as tot
    ) amt;

    -- جلسات (3 لكل قضية ≈ 9000)
    insert into public.sessions (case_id, firm_id, scheduled_by, court, session_date, session_time, status, notes, session_type)
    select
      c.id,
      fid,
      mgr_id,
      c.court,
      (current_date + ((s - 2) * 14))::date,
      '10:00:00'::time,
      (array['مجدولة','منعقدة','مؤجلة','ملغاة'])[1 + (s % 4)],
      'ملاحظة جلسة QA',
      'جلسة مرافعة'
    from public.cases c
    cross join generate_series(1, 3) s
    where c.firm_id = fid and c.deleted_at is null;

    -- مستندات (40 لكل مكتب)
    insert into public.documents (case_id, uploaded_by, title, category, file_type, file_size, storage_path)
    select
      c.id,
      mgr_id,
      'مستند QA ' || d,
      'مستند قانوني',
      'pdf'::document_type_enum,
      2048 + d,
      'qa/' || fid::text || '/' || c.id::text || '/doc-' || d || '.pdf'
    from (
      select id, row_number() over (order by created_at) as rn
      from public.cases where firm_id = fid and deleted_at is null
    ) c
    cross join generate_series(1, 40) d
    where c.rn = 1 + ((d - 1) % 60);

    -- مرفقات (20 لكل مكتب)
    insert into public.case_attachments (case_id, file_name, file_type, file_size, storage_path, uploaded_by, notes)
    select
      c.id,
      'مرفق-' || c.rn || '.pdf',
      'pdf'::document_type_enum,
      1024 + c.rn,
      'qa/att/' || fid::text || '/' || c.id::text || '/att-' || c.rn || '.pdf',
      mgr_id,
      'ملاحظة مرفق QA'
    from (
      select id, row_number() over (order by created_at) as rn
      from public.cases where firm_id = fid and deleted_at is null
      limit 20
    ) c;

    -- دفعات + سندات قبض (25 لكل مكتب)
    for case_rec in
      select id from public.cases where firm_id = fid and deleted_at is null order by created_at limit 25
    loop
      insert into public.case_payments (firm_id, case_id, amount, payment_date, payment_method, notes, created_by)
      values (fid, case_rec.id, (1000 + random() * 15000)::numeric(12,2), current_date, 'نقداً', 'دفعة QA', mgr_id)
      returning id into pay_id;

      select coalesce(max(nullif(regexp_replace(receipt_number, '^RV-' || v_year || '-', ''), '')::bigint), 0) + 1
      into v_seq
      from public.receipt_vouchers where firm_id = fid and receipt_number like 'RV-' || v_year || '-%';

      insert into public.receipt_vouchers (
        firm_id, case_id, case_payment_id, receipt_number, amount,
        payment_method, notes, printed_by
      )
      select
        fid, case_rec.id, pay_id,
        'RV-' || v_year || '-' || lpad(v_seq::text, 5, '0'),
        cp.amount, cp.payment_method, cp.notes, mgr_id
      from public.case_payments cp where cp.id = pay_id;
    end loop;

    -- مصروفات (سندات صرف تشغيلية — 15 لكل مكتب)
    insert into public.office_expenses (firm_id, title, amount, category, expense_date, notes, created_by)
    select
      fid,
      'مصروف QA ' || e,
      (500 + random() * 5000)::numeric(12,2),
      (array['إيجار','قرطاسية','اتصالات','رواتب'])[1 + (e % 4)],
      (current_date - e)::date,
      'مصروف مكتب QA',
      mgr_id
    from generate_series(1, 15) e;

    -- إشعارات
    insert into public.notifications (firm_id, employee_id, title, message, type)
    select
      fid,
      mgr_id,
      'إشعار QA ' || n,
      'تنبيه اختبار نظام — جلسة أو مستند',
      (array['session','document','case','system']::notification_type_enum[])[1 + (n % 4)]
    from generate_series(1, 20) n;

    -- سجل نشاط (عينة)
    insert into public.case_timeline_events (firm_id, case_id, event_type, title, details, actor_id)
    select
      fid,
      c.id,
      'note_added',
      'ملاحظة QA',
      'حدث نشاط تجريبي',
      mgr_id
    from public.cases c
    where c.firm_id = fid
    order by c.created_at
    limit 10;

    raise notice 'Seeded firm % / 50 (id=%)', fi, fid;
  end loop;

  alter table public.sessions enable trigger trg_timeline_session;
  alter table public.case_payments enable trigger trg_timeline_case_payment;
  alter table public.documents enable trigger trg_timeline_document;
end $qa$;

-- إحصائيات بعد البذر
select
  (select count(*) from public.firms where name like 'مكتب QA %') as qa_firms,
  (select count(*) from public.clients c join public.firms f on f.id = c.firm_id where f.name like 'مكتب QA %') as qa_clients,
  (select count(*) from public.cases c join public.firms f on f.id = c.firm_id where f.name like 'مكتب QA %') as qa_cases,
  (select count(*) from public.sessions s join public.firms f on f.id = s.firm_id where f.name like 'مكتب QA %') as qa_sessions,
  (select count(*) from public.documents d join public.cases c on c.id = d.case_id join public.firms f on f.id = c.firm_id where f.name like 'مكتب QA %') as qa_documents,
  (select count(*) from public.case_payments p join public.firms f on f.id = p.firm_id where f.name like 'مكتب QA %') as qa_payments,
  (select count(*) from public.receipt_vouchers r join public.firms f on f.id = r.firm_id where f.name like 'مكتب QA %') as qa_receipts,
  (select count(*) from public.office_expenses e join public.firms f on f.id = e.firm_id where f.name like 'مكتب QA %') as qa_expenses,
  (select count(*) from public.notifications n join public.firms f on f.id = n.firm_id where f.name like 'مكتب QA %') as qa_notifications;
