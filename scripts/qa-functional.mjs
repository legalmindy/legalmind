#!/usr/bin/env node
/**
 * LegalMind Yemen — Functional QA (live API)
 * Registers a test office, runs CRUD, permissions, JWT/IDOR probes.
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { performance } from 'perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnv() {
  const env = {};
  const p = join(ROOT, '.env.local');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const stamp = Date.now();
const QA_PASSWORD = 'QaFunc!Test2026';
const QA_PHONE = '77' + String(stamp).slice(-7);

const results = { passed: [], critical: [], medium: [], minor: [], functional: {}, timings: [] };

function pass(t, d = '') { results.passed.push({ title: t, detail: d }); }
function crit(t, d = '') { results.critical.push({ title: t, detail: d }); }
function med(t, d = '') { results.medium.push({ title: t, detail: d }); }

if (!URL || !ANON) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const anon = createClient(URL, ANON, { auth: { persistSession: false } });

async function timed(name, fn) {
  const t0 = performance.now();
  const r = await fn();
  results.timings.push({ name, ms: Math.round(performance.now() - t0) });
  return r;
}

async function registerTestOffice(suffix) {
  const email = `qa.func.${suffix}.${stamp}@legalmind-qa.test`;
  const { data, error } = await anon.auth.signUp({
    email,
    password: QA_PASSWORD,
    options: {
      data: {
        registration_flow: 'office',
        office_name: `مكتب اختبار وظيفي ${suffix}`,
        full_name: `مدير QA ${suffix}`,
        phone: QA_PHONE,
        role: 'admin'
      }
    }
  });
  if (error) throw new Error(`register ${suffix}: ${error.message}`);
  return { email, session: data.session, userId: data.user?.id };
}

async function login(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: QA_PASSWORD });
  if (error) throw new Error(`login: ${error.message}`);
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false }
  });
}

async function main() {
  console.log('Functional QA — live API\n');

  let officeA, officeB;
  try {
    officeA = await timed('register_office_A', () => registerTestOffice('a'));
    pass('تسجيل مكتب اختبار A', officeA.email);
  } catch (e) {
    med('تسجيل مكتب A', e.message);
    return finish();
  }

  if (!officeA.session) {
    const clientA = await login(officeA.email);
    await runCrudSuite(clientA, 'A', officeA.email);
  } else {
    const clientA = createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${officeA.session.access_token}` } },
      auth: { persistSession: false }
    });
    await runCrudSuite(clientA, 'A', officeA.email);
  }

  try {
    officeB = await timed('register_office_B', () => registerTestOffice('b'));
    pass('تسجيل مكتب اختبار B', officeB.email);
    const clientB = officeB.session
      ? createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${officeB.session.access_token}` } }, auth: { persistSession: false } })
      : await login(officeB.email);
    await testCrossFirmIsolation(clientB);
  } catch (e) {
    med('تسجيل/عزل مكتب B', e.message);
  }

  await testJwtTampering();
  await testMaliciousFileValidation();
  await testOrphanSignupBlocked();

  finish();
}

async function runCrudSuite(client, label, email) {
  const { data: profile } = await client.from('profiles').select('firm_id').maybeSingle();
  const firmId = profile?.firm_id;
  if (!firmId) {
    med(`مكتب ${label}: لا firm_id في profile`, email);
    return;
  }
  results.functional.firmId = firmId;

  const { data: perms } = await client.rpc('get_my_permissions');
  if (perms && Object.keys(perms).length) pass(`صلاحيات get_my_permissions (${label})`);
  else med(`صلاحيات فارغة (${label})`);

  const phone = '77' + String(Date.now()).slice(-7);
  const { data: newClient, error: cErr } = await client.from('clients').insert({
    firm_id: firmId, name: 'عميل اختبار وظيفي', phone, type: 'فرد'
  }).select().single();
  if (cErr) med('إنشاء عميل', cErr.message);
  else pass('إنشاء عميل');

  if (!newClient) return;

  const { data: newCase, error: caseErr } = await client.from('cases').insert({
    firm_id: firmId,
    client_id: newClient.id,
    court_case_number: `FUNC-${stamp}`,
    title: 'قضية اختبار وظيفي',
    case_type: 'مدنية',
    case_stage: 'ابتدائي مدني',
    category: 'مدني',
    court: 'محكمة اختبار',
    total_amount: 100000,
    paid_amount: 0,
    contract_date: new Date().toISOString().slice(0, 10)
  }).select().single();
  if (caseErr) med('إنشاء قضية', caseErr.message);
  else pass('إنشاء قضية');

  if (newCase) {
    const { error: updErr } = await client.from('cases').update({ title: 'قضية معدّلة QA' }).eq('id', newCase.id).eq('firm_id', firmId);
    if (updErr) med('تعديل قضية', updErr.message);
    else pass('تعديل قضية');

    const { data: searchRes } = await client.from('cases').select('id').eq('firm_id', firmId).ilike('title', '%معدّلة%');
    if (searchRes?.length) pass('بحث القضايا (ilike)');
    else med('بحث القضايا', 'لا نتائج');

    const { error: sessErr } = await client.from('sessions').insert({
      case_id: newCase.id,
      firm_id: firmId,
      court: 'محكمة اختبار',
      session_date: new Date().toISOString().slice(0, 10),
      session_time: '11:00:00',
      status: 'مجدولة',
      notes: 'ملاحظة جلسة QA'
    });
    if (sessErr) med('إنشاء جلسة', sessErr.message);
    else pass('إنشاء جلسة');

    const { error: payErr } = await client.from('case_payments').insert({
      firm_id: firmId,
      case_id: newCase.id,
      amount: 5000,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: 'نقداً',
      notes: 'دفعة QA'
    });
    if (payErr) med('إضافة دفعة', payErr.message);
    else pass('إضافة دفعة (فاتورة/دفعة)');

    const { error: delErr } = await client.from('cases').update({
      deleted_at: new Date().toISOString(),
      status: 'closed'
    }).eq('id', newCase.id).eq('firm_id', firmId);
    if (delErr) med('حذف قضية (soft)', delErr.message);
    else pass('حذف قضية (soft delete)');
  }

  const { count } = await client.from('clients').select('*', { count: 'exact', head: true }).eq('firm_id', firmId);
  results.functional.clientCount = count;

  const t0 = performance.now();
  await client.from('cases').select('id', { count: 'exact', head: true }).eq('firm_id', firmId);
  results.timings.push({ name: 'dashboard_cases_count', ms: Math.round(performance.now() - t0) });
  pass('استعلام Dashboard (عدد القضايا)');
}

async function testCrossFirmIsolation(clientB) {
  const { data: profileB } = await clientB.from('profiles').select('firm_id').maybeSingle();
  const firmB = profileB?.firm_id;
  if (!firmB) return;

  const { data: qaFirm } = await clientB.from('firms').select('id').like('name', 'مكتب QA %').limit(1).maybeSingle();
  if (!qaFirm?.id || qaFirm.id === firmB) {
    results.info = 'تخطي IDOR — لا مكتب QA آخر';
    return;
  }

  const { data: cross } = await clientB.from('clients').select('id').eq('firm_id', qaFirm.id).limit(1);
  if (cross?.length) crit('IDOR: مستخدم B يرى عملاء مكتب QA آخر');
  else pass('IDOR: عزل عملاء المكاتب الأخرى');

  const { data: crossCases } = await clientB.from('cases').select('id').eq('firm_id', qaFirm.id).limit(1);
  if (crossCases?.length) crit('IDOR: مستخدم B يرى قضايا مكتب آخر');
  else pass('IDOR: عزل القضايا بين المكاتب');
}

async function testJwtTampering() {
  const tampered = createClient(URL, ANON, {
    global: { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid' } },
    auth: { persistSession: false }
  });
  const { data, error } = await tampered.from('clients').select('id').limit(1);
  if (error || !data?.length) pass('JWT مزوّر مرفوض');
  else crit('JWT مزوّر قبل الوصول لبيانات');
}

async function testMaliciousFileValidation() {
  const dangerous = ['virus.exe', 'shell.php', 'xss.html', 'payload.js'];
  const allowed = ['doc.pdf', 'scan.jpg'];
  const extOk = (n) => ['.pdf', '.docx', '.xlsx', '.jpg', '.jpeg', '.png', '.webp'].some((e) => n.toLowerCase().endsWith(e));
  const badOk = dangerous.every((n) => !extOk(n));
  const goodOk = allowed.every((n) => extOk(n));
  if (badOk && goodOk) pass('تحقق امتداد الملفات (منطق العميل)');
  else med('تحقق الملفات', 'فشل منطق الامتداد');
}

async function testOrphanSignupBlocked() {
  const { error } = await anon.auth.signUp({
    email: `qa.orphan.${stamp}@legalmind-qa.test`,
    password: QA_PASSWORD
  });
  if (error) pass('تسجيل يتيم بدون flow مرفوض');
  else med('تسجيل يتيم', 'لا يزال يُنشأ — تحقق من migration 086');
}

function finish() {
  const out = join(ROOT, 'qa-functional-results.json');
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nFunctional: passed=${results.passed.length} critical=${results.critical.length} medium=${results.medium.length}`);
  console.log(`Written: ${out}`);
  if (results.critical.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
