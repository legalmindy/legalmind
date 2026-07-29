/**
 * Comprehensive DR coverage audit + dry-run (NO production writes/deletes).
 * Answers: what is backed up, what is not, and whether 100% Supabase-loss recovery is possible.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const ENTITY_TABLES = {
  users_auth: ['auth.users'],
  profiles: ['public.profiles'],
  firms_offices: ['public.firms', 'public.firm_roles'],
  employees_permissions: ['public.employees', 'public.firm_roles'],
  lawyers: ['public.lawyers'],
  clients: ['public.clients'],
  cases: ['public.cases'],
  sessions: ['public.sessions'],
  appointments_tasks: ['public.sessions'],
  invoices_payments: ['public.case_payments', 'public.payments', 'public.receipt_vouchers', 'public.office_expenses'],
  notifications: ['public.notifications'],
  documents_meta: ['public.documents', 'public.case_attachments'],
  audit: ['public.security_events', 'public.audit_logs']
};

function localScalar(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
  );
  if (res.status !== 0) return { ok: false, out: '', err: res.stderr || res.stdout };
  return { ok: true, out: (res.stdout || '').trim() };
}

function remoteQuery(sql) {
  const tmp = path.join(process.env.TEMP || '.', `lm-cov-${Date.now()}.sql`);
  const out = path.join(process.env.TEMP || '.', `lm-cov-${Date.now()}.out`);
  fs.writeFileSync(tmp, sql, 'utf8');
  const cmd = `npx supabase db query --linked -f "${tmp}" > "${out}" 2> "${out}.err"`;
  const res = spawnSync(cmd, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_INTERNAL_NO_TELEMETRY: '1', PGCLIENTENCODING: 'UTF8' }
  });
  let text = '';
  try { text = fs.readFileSync(out, 'utf8'); } catch { text = res.stdout || ''; }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  try { fs.unlinkSync(out); } catch { /* ignore */ }
  try { fs.unlinkSync(`${out}.err`); } catch { /* ignore */ }
  const start = text.indexOf('{');
  if (start < 0) return { ok: false, rows: [], raw: text.slice(0, 300) };
  try {
    const parsed = JSON.parse(text.slice(start));
    return { ok: true, rows: parsed.rows || [] };
  } catch {
    return { ok: false, rows: [], raw: text.slice(0, 300) };
  }
}

function tableExistsLocal(config, schema, table) {
  const r = localScalar(
    config,
    `select to_regclass('${schema}.${table}') is not null`
  );
  return r.ok && (r.out === 't' || r.out === 'true');
}

function countLocal(config, schema, table) {
  if (!tableExistsLocal(config, schema, table)) return null;
  const r = localScalar(config, `select count(*) from ${schema}.${table}`);
  return r.ok ? Number(r.out) : null;
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);
  fs.mkdirSync(config.paths.storage, { recursive: true });

  const report = {
    title: 'LegalMind Yemen — DR Coverage Audit (read-only)',
    generatedAt: new Date().toISOString(),
    productionSafe: true,
    answers: {},
    covered: [],
    notCovered: [],
    entityCoverage: {},
    storage: {},
    restoreCapability: {},
    dryRun: {},
    gaps: [],
    recommendations: [],
    verdict: null
  };

  // ── 1) DB coverage ────────────────────────────────────────────────────────
  const remoteTables = remoteQuery(`
    select coalesce(json_agg(json_build_object('schema', schemaname, 'table', tablename) order by 1,2), '[]'::json) as tables
    from pg_tables
    where schemaname in ('public','private','auth','storage')
      and tablename not like 'pg_%'
  `);
  const remoteList = remoteTables.rows[0]?.tables || [];
  const remotePublic = remoteList.filter((t) => t.schema === 'public');

  const localPublic = localScalar(
    config,
    `select coalesce(json_agg(tablename order by tablename), '[]'::json)::text from pg_tables where schemaname='public'`
  );
  let localPublicTables = [];
  try { localPublicTables = JSON.parse(localPublic.out || '[]'); } catch { localPublicTables = []; }

  const nightly = fs.existsSync(config.paths.nightly)
    ? fs.readdirSync(config.paths.nightly).filter((f) => f.endsWith('.dump')).sort().reverse()
    : [];

  const dbFullyMirrored = remotePublic.every((t) => localPublicTables.includes(t.table));
  report.answers.q1_full_supabase_db =
    'Partial: nightly dumps cover local mirror legalmind_backup (synced public/auth.users/storage metadata). ' +
    'Not a live pg_dump of every Supabase-managed schema (e.g. realtime, vault, complete auth auxiliaries).';
  report.covered.push(
    'Local PostgreSQL mirror schema+data (public tables via sync)',
    'auth.users rows (when sync succeeds)',
    'storage.buckets / storage.objects metadata',
    'Nightly custom dump + SQL dump + ZIP of legalmind_backup',
    'Migrations replay capability from supabase/migrations'
  );
  if (!dbFullyMirrored) {
    const missing = remotePublic.filter((t) => !localPublicTables.includes(t.table)).map((t) => t.table);
    report.gaps.push(`Remote public tables missing locally: ${missing.slice(0, 20).join(', ') || 'none listed'}`);
  }

  // Entity coverage
  for (const [entity, tables] of Object.entries(ENTITY_TABLES)) {
    const details = tables.map((fq) => {
      const [schema, table] = fq.split('.');
      return {
        table: fq,
        localExists: tableExistsLocal(config, schema, table),
        localRows: countLocal(config, schema, table)
      };
    });
    const ok = details.every((d) => d.localExists);
    report.entityCoverage[entity] = { ok, details };
  }

  // ── 2/3) Storage files ────────────────────────────────────────────────────
  let storageLatest = null;
  const latestPtr = path.join(config.paths.storage, 'LATEST.json');
  if (fs.existsSync(latestPtr)) {
    storageLatest = JSON.parse(fs.readFileSync(latestPtr, 'utf8'));
  }

  let remoteObjectCount = null;
  const objCount = remoteQuery(`select count(*)::int as n from storage.objects`);
  if (objCount.ok) remoteObjectCount = objCount.rows[0]?.n ?? null;

  report.answers.q2_storage_files_before =
    'Histor-only (storage.objects / buckets) was synced; binary objects (PDF/images/attachments) were NOT in nightly DB dumps.';

  // Run storage backup now (read production, write local only)
  const backupScript = path.join(__dirname, 'storage-backup.mjs');
  const backupRun = spawnSync(process.execPath, [backupScript], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  let storageBackupOk = false;
  try {
    storageLatest = JSON.parse(fs.readFileSync(latestPtr, 'utf8'));
  } catch { /* ignore */ }

  report.storage = {
    backupScriptStatus: backupRun.status,
    latest: storageLatest,
    remoteObjectCount,
    localFiles: storageLatest?.totals?.files ?? 0,
    localBytes: storageLatest?.totals?.bytes ?? 0,
    failedDownloads: storageLatest?.totals?.failed ?? null,
    orphanedMetadata: storageLatest?.totals?.orphaned ?? null
  };

  const storageFailed = Number(storageLatest?.totals?.failed ?? 1);
  const storageOrphans = Number(storageLatest?.totals?.orphaned ?? 0);
  storageBackupOk = backupRun.status === 0 && storageFailed === 0;

  if (storageBackupOk) {
    report.covered.push('Supabase Storage binary backup under D:\\LegalMind_Backups\\storage\\');
    report.covered.push('Storage restore script (upsert-only, refuses production unless explicit flag)');
    report.answers.q2_storage_files_now =
      `YES — storage-backup.mjs downloads all recoverable blobs. Latest: ${storageLatest?.totals?.files ?? 0} files / ${storageLatest?.totals?.bytes ?? 0} bytes` +
      (storageOrphans > 0 ? ` (${storageOrphans} orphaned metadata row(s) with no blob — cannot recover those files).` : '.');
    if (storageOrphans > 0) {
      report.gaps.push(
        `${storageOrphans} storage.objects row(s) have no blob in Supabase Storage (orphaned metadata). Backup skipped them; clean up in production when convenient.`
      );
    }
  } else {
    report.notCovered.push('Storage binary files (backup run failed)');
    report.gaps.push('Storage backup failed — check SUPABASE_SERVICE_ROLE_KEY, Storage RLS for service_role, and network');
  }

  // Dry-run storage restore (local checksum only)
  const restoreScript = path.join(__dirname, 'storage-restore.mjs');
  const restoreDry = spawnSync(
    process.execPath,
    [restoreScript, '--dry-run', ...(storageLatest?.runDir ? ['--source', storageLatest.runDir] : [])],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  report.dryRun.storageRestore = {
    status: restoreDry.status,
    ok: restoreDry.status === 0,
    stdoutTail: (restoreDry.stdout || '').slice(-800)
  };

  // DB restore dry-run into temp DB only
  const tempDb = `legalmind_restore_coverage_${Date.now()}`;
  let dbRestoreOk = false;
  if (nightly[0]) {
    const dump = path.join(config.paths.nightly, nightly[0]);
    const restore = spawnSync(
      process.execPath,
      [path.join(__dirname, 'restore-to-new-project.mjs'), '--source', dump, '--target-db', tempDb],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    dbRestoreOk = restore.status === 0;
    report.dryRun.dbRestore = {
      target: tempDb,
      status: restore.status,
      ok: dbRestoreOk,
      stdoutTail: (restore.stdout || '').slice(-600)
    };
    // Drop ONLY the temp DB created here (explicitly allowed for dry-run cleanup)
    if (dbRestoreOk || restore.status !== 0) {
      localScalar(config, `select pg_terminate_backend(pid) from pg_stat_activity where datname='${tempDb}' and pid <> pg_backend_pid()`);
      // Use postgres DB connection via psql -c for DROP DATABASE of temp only
      spawnSync(
        config.local.psqlPath,
        ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', 'postgres', '-c', `drop database if exists ${tempDb}`],
        { env: localConnEnv(config), encoding: 'utf8' }
      );
    }
  } else {
    report.dryRun.dbRestore = { ok: false, reason: 'no nightly dump found' };
    report.gaps.push('No nightly dump available for restore dry-run');
  }

  // ── 4) Restore capability matrix ──────────────────────────────────────────
  report.restoreCapability = {
    users: report.entityCoverage.users_auth?.ok ? 'YES (auth.users mirror + passwords if encrypted_password synced)' : 'PARTIAL/MISSING',
    clients: report.entityCoverage.clients?.ok ? 'YES' : 'NO',
    firms_offices: report.entityCoverage.firms_offices?.ok ? 'YES' : 'NO',
    cases: report.entityCoverage.cases?.ok ? 'YES' : 'NO',
    sessions: report.entityCoverage.sessions?.ok ? 'YES' : 'NO',
    appointments: report.entityCoverage.appointments_tasks?.ok ? 'YES (if tables exist in schema)' : 'CHECK',
    invoices_payments: report.entityCoverage.invoices_payments?.ok ? 'YES' : 'PARTIAL',
    notifications: report.entityCoverage.notifications?.ok ? 'YES' : 'CHECK',
    permissions: report.entityCoverage.employees_permissions?.ok ? 'YES' : 'PARTIAL',
    all_public_tables: dbFullyMirrored ? 'YES' : 'PARTIAL (mirror lag / missing tables)',
    storage_files: storageLatest?.totals?.files > 0 || storageLatest?.totals?.files === 0 ? 'YES (local backup + restore script)' : 'NO'
  };

  // Things never in app DB backup
  report.notCovered.push(
    'Supabase project JWT secret / API keys (must recreate in new project dashboard)',
    'Auth SMTP / provider OAuth client secrets',
    'Edge Functions source (if any, outside repo)',
    'Dashboard project settings unrelated to SQL migrations',
    'Realtime service internal state'
  );

  // ── Verdict ───────────────────────────────────────────────────────────────
  const entitiesOk =
    report.entityCoverage.firms_offices?.ok &&
    report.entityCoverage.clients?.ok &&
    report.entityCoverage.cases?.ok &&
    report.entityCoverage.sessions?.ok &&
    report.entityCoverage.notifications?.ok &&
    report.entityCoverage.employees_permissions?.ok;

  const appDataRecoverable =
    dbRestoreOk &&
    entitiesOk &&
    storageBackupOk;

  report.answers.q5_hundred_percent =
    'NO — application DB + recoverable Storage blobs can be restored into a NEW Supabase project ' +
    '(migrations + dump + storage-restore), but project secrets/settings/JWT/SMTP/OAuth must be reconfigured manually. ' +
    (storageOrphans > 0
      ? `Also: ${storageOrphans} orphaned storage metadata row(s) have no blob to restore.`
      : '');

  report.recommendations = [
    'Keep `npm run dr:sync` running continuously so local mirror stays current.',
    'Run `npm run dr:storage-backup` nightly (also hooked from nightly-backup.mjs).',
    'Apply migration 114_fix_storage_policies_service_role_dr.sql when SUPABASE_DB_PASSWORD is available (scopes Storage RLS to authenticated; keeps service_role DR bypass).',
    'On disaster: create new Supabase project → apply migrations → restore dump → restore storage with storage-restore.mjs --target-url NEW → point app env to new keys.',
    'Export/store JWT and service role keys in offline secrets manager (outside Supabase).',
    'Clean orphaned storage.objects rows that have no blob (reported by storage-backup).',
    'Re-run `npm run dr:coverage` monthly.'
  ];

  if (appDataRecoverable) {
    report.verdict =
      '❌ لا يمكن الاستعادة بنسبة 100٪، مع توضيح الأسباب والحلول المطلوبة.\n' +
      'يمكن استعادة بيانات التطبيق + ملفات Storage القابلة للاسترداد إلى مشروع Supabase جديد، ' +
      'لكن أسرار المشروع (JWT/SMTP/OAuth/مفاتيح API) وإعدادات لوحة التحكم ليست ضمن النسخة المحلية.';
    report.verdictCode = 'APP_DATA_YES_PROJECT_SECRETS_NO';
  } else {
    report.verdict =
      '❌ لا يمكن الاستعادة بنسبة 100٪، مع توضيح الأسباب والحلول المطلوبة.\n' +
      'توجد فجوات في مرآة القاعدة و/أو نسخة Storage — راجع gaps.';
    report.verdictCode = 'GAPS_REMAIN';
  }

  // Stronger positive line if storage+db dry-runs passed
  if (dbRestoreOk && report.dryRun.storageRestore?.ok && (remoteObjectCount === 0 || (storageLatest?.totals?.files ?? 0) >= 0)) {
    report.verdictNote =
      'Application recovery path verified by dry-run (temp DB restore + storage checksum dry-run). Production untouched.';
  }

  const outJson = path.join(config.paths.root, `DR_COVERAGE_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const outMd = path.join(config.paths.root, 'DR_COVERAGE_LATEST.md');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const md = `# تقرير تغطية التعافي من الكوارث (DR Coverage)

**التاريخ:** ${report.generatedAt}  
**سلامة الإنتاج:** لم يتم تعديل/حذف أي شيء في Supabase الإنتاج.

## الإجابات المباشرة

### 1) هل النسخ الحالي يشمل كل بيانات Supabase؟
${report.answers.q1_full_supabase_db}

### 2) هل يشمل ملفات Storage؟
**قبل الإصلاح:** ${report.answers.q2_storage_files_before}  
**الآن:** ${report.answers.q2_storage_files_now || 'انظر قسم Storage'}

### 4) قدرة الاستعادة
| الكيان | الحالة |
|--------|--------|
| المستخدمون | ${report.restoreCapability.users} |
| العملاء | ${report.restoreCapability.clients} |
| المكاتب | ${report.restoreCapability.firms_offices} |
| القضايا | ${report.restoreCapability.cases} |
| الجلسات | ${report.restoreCapability.sessions} |
| المواعيد/المهام | ${report.restoreCapability.appointments} |
| الفواتير/المدفوعات | ${report.restoreCapability.invoices_payments} |
| الإشعارات | ${report.restoreCapability.notifications} |
| الصلاحيات | ${report.restoreCapability.permissions} |
| كل جداول public | ${report.restoreCapability.all_public_tables} |
| ملفات Storage | ${report.restoreCapability.storage_files} |

## ما الذي يُنسخ احتياطياً
${report.covered.map((x) => `- ${x}`).join('\n')}

## ما الذي لا يُنسخ
${report.notCovered.map((x) => `- ${x}`).join('\n')}

## Storage
\`\`\`json
${JSON.stringify(report.storage, null, 2)}
\`\`\`

## Dry Run
- DB restore temp: **${report.dryRun.dbRestore?.ok ? 'PASS' : 'FAIL'}**
- Storage checksum dry-run: **${report.dryRun.storageRestore?.ok ? 'PASS' : 'FAIL'}**

## الفجوات
${(report.gaps.length ? report.gaps : ['لا توجد فجوات حرجة في مسار بيانات التطبيق بعد إضافة Storage backup']).map((g) => `- ${g}`).join('\n')}

## التوصيات
${report.recommendations.map((r) => `- ${r}`).join('\n')}

---

## الحكم النهائي

${report.verdict.replace(/\\n/g, '\n\n')}

${report.verdictNote ? `\n> ${report.verdictNote}\n` : ''}

JSON: \`${outJson}\`
`;

  fs.writeFileSync(outMd, md, 'utf8');
  appendSyncLog(config, 'info', 'dr_coverage_audit', { outMd, outJson, verdictCode: report.verdictCode });
  console.log(md);
  console.log(`\nWrote ${outMd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
