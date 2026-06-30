-- LegalMind Yemen — QA staging seed (run in STAGING ONLY via SQL Editor as postgres)
-- Creates synthetic multi-tenant load-test data without auth.users (employees.auth_uid = NULL).
-- For login/E2E tests, create auth users via Supabase Admin API and link auth_uid separately.
--
-- Params (edit before run):
--   :num_firms = 50
--   :clients_per_firm = 12  → 600 clients
--   :cases_per_firm = 65    → 3250 cases
--   :sessions_per_case = 2  → ~6500 sessions
--
-- WARNING: Long-running on shared Supabase tiers. Run off-peak. Do NOT run on production.

do $$
declare
  v_num_firms int := 50;
  v_clients_per_firm int := 12;
  v_cases_per_firm int := 65;
  v_sessions_per_case int := 2;
  v_firm_id uuid;
  v_owner_emp_id uuid;
  v_lawyer_emp_id uuid;
  v_client_id uuid;
  v_case_id uuid;
  v_firm_code text;
  v_i int;
  v_j int;
  v_k int;
  v_s int;
  v_role_rec record;
begin
  perform set_config('row_security', 'off', true);

  for v_i in 1..v_num_firms loop
    v_firm_code := 'QA-' || lpad(v_i::text, 4, '0');

    insert into public.firms (name, license_no, plan, firm_code, subscription_status, subscription_plan)
    values (
      'مكتب QA ' || v_i,
      'LIC-QA-' || v_i,
      case when v_i % 3 = 0 then 'pro' when v_i % 5 = 0 then 'enterprise' else 'free' end,
      v_firm_code,
      'active',
      'quarterly'
    )
    returning id into v_firm_id;

    perform public.seed_firm_role_templates(v_firm_id);

    -- Owner / manager
    insert into public.employees (firm_id, full_name, email, role, status)
    values (v_firm_id, 'مدير مكتب ' || v_i, 'qa-owner-' || v_i || '@loadtest.local', 'firm_manager', 'active')
    returning id into v_owner_emp_id;

    -- 5 lawyers
    for v_j in 1..5 loop
      insert into public.employees (firm_id, full_name, email, role, status)
      values (v_firm_id, 'محامي ' || v_j || ' — مكتب ' || v_i, 'qa-lawyer-' || v_i || '-' || v_j || '@loadtest.local', 'lawyer', 'active')
      returning id into v_lawyer_emp_id;
      insert into public.lawyers (employee_id, specialization, total_cases)
      values (v_lawyer_emp_id, 'عام', 10 + v_j);
    end loop;

    -- 3 secretaries
    for v_j in 1..3 loop
      insert into public.employees (firm_id, full_name, email, role, status)
      values (v_firm_id, 'سكرتير ' || v_j || ' — مكتب ' || v_i, 'qa-sec-' || v_i || '-' || v_j || '@loadtest.local', 'assistant', 'active');
    end loop;

    -- 2 accountants (firm_roles slug accountant)
    select id into v_role_rec from public.firm_roles where firm_id = v_firm_id and slug = 'accountant' limit 1;
    for v_j in 1..2 loop
      insert into public.employees (firm_id, full_name, email, role, status, firm_role_id)
      values (
        v_firm_id,
        'محاسب ' || v_j || ' — مكتب ' || v_i,
        'qa-acct-' || v_i || '-' || v_j || '@loadtest.local',
        'assistant',
        'active',
        v_role_rec.id
      );
    end loop;

    -- 1 archivist (custom role or assistant)
    insert into public.employees (firm_id, full_name, email, role, status)
    values (v_firm_id, 'أرشيف — مكتب ' || v_i, 'qa-archive-' || v_i || '@loadtest.local', 'assistant', 'active');

    -- Clients
    for v_j in 1..v_clients_per_firm loop
      insert into public.clients (firm_id, name, phone, email, type, cases_count)
      values (
        v_firm_id,
        'عميل ' || v_j || ' — مكتب ' || v_i,
        '77' || lpad((1000000 + v_j)::text, 7, '0'),
        'qa-client-' || v_i || '-' || v_j || '@loadtest.local',
        case when v_j % 2 = 0 then 'شركة تجارية' else 'فرد' end,
        0
      )
      returning id into v_client_id;

      -- Cases per client batch
      for v_k in 1..(v_cases_per_firm / v_clients_per_firm + case when v_j <= (v_cases_per_firm % v_clients_per_firm) then 1 else 0 end) loop
        insert into public.cases (
          firm_id, client_id, title, court_case_number, court, case_type, case_stage, status,
          total_amount, paid_amount, contract_currency, contract_date
        )
        values (
          v_firm_id,
          v_client_id,
          'قضية ' || v_k || ' — عميل ' || v_j,
          'QA-' || v_i || '-' || v_j || '-' || v_k,
          'محكمة QA',
          'مدنية',
          'ابتدائي مدني',
          case when v_k % 17 = 0 then 'archived' else 'active' end,
          500000 + (v_k * 1000),
          (v_k * 500),
          'YER',
          current_date - (v_k % 365)
        )
        returning id into v_case_id;

        for v_s in 1..v_sessions_per_case loop
          insert into public.sessions (firm_id, case_id, session_date, session_time, court, notes, status)
          values (
            v_firm_id,
            v_case_id,
            current_date + (v_s * 7),
            '09:00',
            'محكمة QA',
            'جلسة تجريبية',
            'مجدولة'
          );
        end loop;

        insert into public.case_payments (firm_id, case_id, amount, payment_date, payment_method, notes)
        values (v_firm_id, v_case_id, 50000, current_date - 30, 'نقداً', 'دفعة تجريبية');

        insert into public.case_timeline_events (firm_id, case_id, event_type, title, details)
        values (v_firm_id, v_case_id, 'note_added', 'ملاحظة QA', 'ملاحظة تجريبية على القضية');

        insert into public.notifications (firm_id, employee_id, title, message, type, read)
        values (v_firm_id, v_owner_emp_id, 'تنبيه QA', 'إشعار تجريبي', 'case', false);
      end loop;
    end loop;

    insert into public.office_expenses (firm_id, title, amount, category, expense_date, notes)
    values (v_firm_id, 'مصروف مكتب', 25000, 'تشغيل', current_date, 'سند صرف تجريبي');

    insert into public.audit_logs (firm_id, table_name, record_id, operation, changes)
    values (v_firm_id, 'firms', v_firm_id, 'INSERT', jsonb_build_object('qa_seed_batch', v_i));
  end loop;

  raise notice 'QA seed complete: % firms', v_num_firms;
end $$;
