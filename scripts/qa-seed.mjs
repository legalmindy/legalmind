#!/usr/bin/env node
/**
 * LegalMind Yemen — Bulk QA seed data
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local or environment.
 *
 * Usage:
 *   node scripts/qa-seed.mjs --firms 50 --clients-per-firm 12 --cases-per-firm 60
 *
 * Creates per firm: 1 manager, 5 lawyers, 3 secretaries, 2 accountants, 1 archive staff
 * + clients, cases, sessions, documents metadata, payments, expenses, notifications, audit entries.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnv() {
  const env = {};
  const path = join(ROOT, '.env.local');
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
function numArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? parseInt(args[i + 1], 10) : def;
}

const FIRM_COUNT = numArg('firms', 50);
const CLIENTS_PER_FIRM = numArg('clients-per-firm', 12);
const CASES_PER_FIRM = numArg('cases-per-firm', 60);
const SESSIONS_PER_CASE = numArg('sessions-per-case', 3);
const DOCS_PER_FIRM = numArg('docs-per-firm', 40);
const PASSWORD = env.QA_SEED_PASSWORD || 'QaSeed!LegalMind2026';

const CASE_TYPES = ['مدنية', 'تجارية', 'أحوال شخصية', 'عمالية', 'مستعجلة', 'جنائية'];
const STAGES = ['ابتدائي مدني', 'ابتدائي شخصي', 'ابتدائي جنائي', 'استئناف', 'نقض'];
const COURTS = ['محكمة استئناف صنعاء', 'محكمة ابتدائية عدن', 'محكمة تعز', 'محكمة الحديدة'];
const SESSION_STATUSES = ['مجدولة', 'منعقدة', 'مؤجلة', 'ملغاة'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function phone() { return '77' + String(Math.floor(1000000 + Math.random() * 8999999)); }
function email(prefix, firmIdx, role, n) {
  return `qa.f${firmIdx}.${role}${n}@legalmind-qa.test`;
}

if (!URL || !SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY in .env.local to run bulk seed.');
  console.error('This script creates auth users and bypasses RLS — never commit the service key.');
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createAuthUser(emailAddr, fullName, metadata = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailAddr,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, ...metadata }
  });
  if (error) throw new Error(`auth ${emailAddr}: ${error.message}`);
  return data.user.id;
}

async function seedFirm(firmIdx) {
  const firmName = `مكتب QA ${firmIdx} — ${randomBytes(2).toString('hex')}`;
  const { data: firm, error: firmErr } = await admin
    .from('firms')
    .insert({
      name: firmName,
      license_no: `LIC-QA-${firmIdx}`,
      plan: rand(['pro', 'enterprise', 'free']),
      subscription_status: 'active',
      subscription_plan: 'pro'
    })
    .select('id')
    .single();
  if (firmErr) throw firmErr;
  const firmId = firm.id;

  await admin.rpc('seed_firm_role_templates', { p_firm_id: firmId });

  const staffPlan = [
    { role: 'firm_manager', slug: 'firm_owner', count: 1, empRole: 'firm_manager' },
    { role: 'lawyer', slug: 'lawyer', count: 5, empRole: 'lawyer' },
    { role: 'secretary', slug: 'secretary', count: 3, empRole: 'assistant' },
    { role: 'accountant', slug: 'accountant', count: 2, empRole: 'assistant' },
    { role: 'archive', slug: 'legal_assistant', count: 1, empRole: 'assistant' }
  ];

  const employeeIds = [];
  let lawyerEmployeeIds = [];

  for (const group of staffPlan) {
    for (let n = 0; n < group.count; n++) {
      const name = `${group.role} ${firmIdx}-${n + 1}`;
      const mail = email('staff', firmIdx, group.role, n);
      let authUid;
      if (group.role === 'firm_manager' && n === 0) {
        authUid = await createAuthUser(mail, name, { office_name: firmName, registration_type: 'office' });
        await admin.rpc('create_office_admin_profile', {
          p_user_id: authUid,
          p_office_name: firmName,
          p_full_name: name,
          p_email: mail,
          p_phone: phone()
        });
      } else {
        authUid = await createAuthUser(mail, name, { registration_type: 'member', firm_code: firmId });
        await admin.rpc('create_office_member_profile', {
          p_user_id: authUid,
          p_firm_id: firmId,
          p_full_name: name,
          p_email: mail,
          p_phone: phone()
        });
      }

      const { data: emp } = await admin.from('employees').select('id, role').eq('auth_uid', authUid).single();
      if (emp) {
        employeeIds.push(emp.id);
        if (group.role === 'lawyer') {
          await admin.from('lawyers').upsert({
            employee_id: emp.id,
            specialization: rand(['جنائي', 'مدني', 'تجاري', 'أحوال شخصية']),
            total_cases: 0
          }, { onConflict: 'employee_id' });
          lawyerEmployeeIds.push(emp.id);
        }
      }
    }
  }

  const { data: lawyers } = await admin.from('lawyers')
    .select('id, employee_id')
    .in('employee_id', lawyerEmployeeIds.length ? lawyerEmployeeIds : ['00000000-0000-0000-0000-000000000000']);

  const clientRows = [];
  for (let c = 0; c < CLIENTS_PER_FIRM; c++) {
    clientRows.push({
      firm_id: firmId,
      name: `عميل ${firmIdx}-${c + 1}`,
      phone: phone(),
      type: c % 3 === 0 ? 'شركة تجارية' : 'فرد',
      email: email('client', firmIdx, 'c', c)
    });
  }
  const { data: clients, error: clErr } = await admin.from('clients').insert(clientRows).select('id');
  if (clErr) throw clErr;

  const caseRows = [];
  for (let i = 0; i < CASES_PER_FIRM; i++) {
    const client = clients[i % clients.length];
    const lawyer = lawyers?.[i % (lawyers?.length || 1)];
    caseRows.push({
      firm_id: firmId,
      client_id: client.id,
      assigned_lawyer_id: lawyer?.id ?? null,
      court_case_number: `QA-${firmIdx}-${String(i + 1).padStart(5, '0')}`,
      title: `قضية QA ${firmIdx} #${i + 1}`,
      case_type: rand(CASE_TYPES),
      case_stage: rand(STAGES),
      category: rand(['تجاري', 'مدني', 'جنائي']),
      court: rand(COURTS),
      total_amount: Math.round(50000 + Math.random() * 500000),
      paid_amount: Math.round(Math.random() * 100000),
      status: i % 10 === 0 ? 'archived' : 'active',
      contract_date: new Date(Date.now() - Math.random() * 1e10).toISOString().slice(0, 10)
    });
  }
  const { data: cases, error: caseErr } = await admin.from('cases').insert(caseRows).select('id, client_id, total_amount, paid_amount');
  if (caseErr) throw caseErr;

  const sessionRows = [];
  for (const c of cases) {
    for (let s = 0; s < SESSIONS_PER_CASE; s++) {
      const d = new Date();
      d.setDate(d.getDate() + s * 14 - 30);
      sessionRows.push({
        case_id: c.id,
        scheduled_by: employeeIds[0],
        court: rand(COURTS),
        session_date: d.toISOString().slice(0, 10),
        session_time: '10:00:00',
        status: rand(SESSION_STATUSES),
        notes: `ملاحظة جلسة QA ${s}`
      });
    }
  }
  await admin.from('sessions').insert(sessionRows);

  const docRows = [];
  for (let d = 0; d < DOCS_PER_FIRM; d++) {
    const c = cases[d % cases.length];
    docRows.push({
      case_id: c.id,
      uploaded_by: employeeIds[0],
      title: `مستند QA ${d}`,
      category: 'مستند قانوني',
      file_type: 'pdf',
      file_size: 1024 + d,
      storage_path: `qa/${firmId}/${c.id}/doc-${d}.pdf`
    });
  }
  await admin.from('documents').insert(docRows);

  const payRows = [];
  for (let p = 0; p < Math.min(cases.length, 30); p++) {
    const c = cases[p];
    payRows.push({
      firm_id: firmId,
      case_id: c.id,
      amount: Math.round(1000 + Math.random() * 20000),
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: rand(['نقد', 'تحويل', 'شيك']),
      recorded_by: employeeIds[0],
      notes: 'دفعة QA'
    });
  }
  const { data: payments } = await admin.from('case_payments').insert(payRows).select('id');

  for (const pay of payments ?? []) {
    try {
      await admin.rpc('create_receipt_voucher', { p_payment_id: pay.id });
    } catch { /* may need auth context */ }
  }

  await admin.from('office_expenses').insert(
    Array.from({ length: 15 }, (_, i) => ({
      firm_id: firmId,
      title: `مصروف QA ${i}`,
      amount: Math.round(500 + Math.random() * 5000),
      expense_date: new Date().toISOString().slice(0, 10),
      category: rand(['إيجار', 'قرطاسية', 'اتصالات']),
      recorded_by: employeeIds[0]
    }))
  );

  await admin.from('notifications').insert(
    Array.from({ length: 20 }, (_, i) => ({
      firm_id: firmId,
      employee_id: employeeIds[i % employeeIds.length],
      title: `إشعار QA ${i}`,
      message: 'رسالة اختبار نظام',
      type: rand(['session', 'document', 'case', 'system'])
    }))
  );

  return { firmId, clients: clients.length, cases: cases.length, employees: employeeIds.length };
}

async function main() {
  console.log(`Seeding ${FIRM_COUNT} firms...`);
  const stats = { firms: 0, clients: 0, cases: 0, errors: [] };
  for (let i = 1; i <= FIRM_COUNT; i++) {
    try {
      const r = await seedFirm(i);
      stats.firms++;
      stats.clients += r.clients;
      stats.cases += r.cases;
      console.log(`  [${i}/${FIRM_COUNT}] firm ${r.firmId.slice(0, 8)}… clients=${r.clients} cases=${r.cases}`);
    } catch (e) {
      stats.errors.push({ firm: i, error: e.message });
      console.error(`  [${i}] FAILED:`, e.message);
    }
  }
  console.log('\nDone:', stats);
  if (stats.errors.length) process.exit(1);
}

main();
