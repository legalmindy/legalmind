/**
 * Export non-secret project settings needed for DR into one report.
 * READ-ONLY: never prints secret values; never writes to production.
 *
 *   npm run dr:export-settings
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const SECRET_HINT =
  /KEY|SECRET|PASSWORD|TOKEN|PRIVATE|SERVICE_ROLE|DATABASE_URL|CONNECTION_STRING|JWT/i;

/** Env var catalog — names only; values never exported if secret. */
const ENV_CATALOG = [
  {
    group: 'App (Vite / client)',
    vars: [
      { name: 'VITE_SUPABASE_URL', required: true, secret: false, where: 'Dashboard → Project Settings → API' },
      { name: 'VITE_SUPABASE_ANON_KEY', required: true, secret: true, where: 'Dashboard → Project Settings → API (anon public)' },
      { name: 'VITE_APP_URL', required: false, secret: false, where: 'Public app URL used for Auth redirects' },
      { name: 'VITE_AUTH_SHARED_SESSION', required: false, secret: false, where: 'Optional; true = share login across tabs' },
      { name: 'VITE_APP_VERSION', required: false, secret: false, where: 'Injected by vite.config from package.json' },
      { name: 'VITE_APP_VERSION_CODE', required: false, secret: false, where: 'Injected by vite.config' },
      { name: 'VITE_STRIPE_PUBLISHABLE_KEY', required: false, secret: true, where: 'Stripe dashboard (future payments)' }
    ]
  },
  {
    group: 'Disaster Recovery / sync',
    vars: [
      { name: 'SUPABASE_URL', required: true, secret: false, where: 'Same as project URL' },
      { name: 'SUPABASE_ANON_KEY', required: false, secret: true, where: 'Dashboard → API' },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, secret: true, where: 'Dashboard → API (service_role — NEVER in client)' },
      { name: 'SUPABASE_DB_PASSWORD', required: false, secret: true, where: 'Dashboard → Database settings (for CLI migrations)' },
      { name: 'LOCAL_PG_HOST', required: true, secret: false, where: '.env.disaster-recovery' },
      { name: 'LOCAL_PG_PORT', required: true, secret: false, where: '.env.disaster-recovery' },
      { name: 'LOCAL_PG_DATABASE', required: true, secret: false, where: '.env.disaster-recovery' },
      { name: 'LOCAL_PG_USER', required: true, secret: false, where: '.env.disaster-recovery' },
      { name: 'LOCAL_PG_PASSWORD', required: true, secret: true, where: 'Local only' },
      { name: 'LOCAL_PSQL_PATH', required: false, secret: false, where: 'PostgreSQL bin' },
      { name: 'LOCAL_PG_DUMP_PATH', required: false, secret: false, where: 'PostgreSQL bin' },
      { name: 'LOCAL_PG_RESTORE_PATH', required: false, secret: false, where: 'PostgreSQL bin' },
      { name: 'BACKUP_ROOT', required: false, secret: false, where: 'Default D:\\LegalMind_Backups' },
      { name: 'BACKUP_KEEP_VERIFIED', required: false, secret: false, where: 'Retention count (archive, never delete)' },
      { name: 'SYNC_POLL_INTERVAL_MS', required: false, secret: false, where: 'Sync poll interval' },
      { name: 'SYNC_BATCH_SIZE', required: false, secret: false, where: 'Sync batch size' },
      { name: 'SYNC_MAX_RETRIES', required: false, secret: false, where: 'Sync retry limit' },
      { name: 'DR_REQUIRE_SERVICE_ROLE', required: false, secret: false, where: 'Warn if service role missing' }
    ]
  },
  {
    group: 'Edge Functions (Deno secrets)',
    vars: [
      { name: 'SUPABASE_URL', required: true, secret: false, where: 'Auto-injected in hosted functions' },
      { name: 'SUPABASE_ANON_KEY', required: true, secret: true, where: 'Function secrets' },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, secret: true, where: 'Function secrets' },
      { name: 'SITE_URL', required: false, secret: false, where: 'invite-user redirect base (set in Function secrets)' }
    ]
  },
  {
    group: 'Supabase project secrets (dashboard only — cannot auto-restore)',
    vars: [
      { name: 'JWT_SECRET', required: true, secret: true, where: 'Project Settings → API → JWT Secret (project-specific)' },
      { name: 'POSTGRES_PASSWORD', required: true, secret: true, where: 'Database password for new project' },
      { name: 'SMTP_*', required: true, secret: true, where: 'Authentication → Emails → SMTP Settings' },
      { name: 'OAUTH_CLIENT_ID/SECRET_*', required: false, secret: true, where: 'Authentication → Providers (if enabled)' }
    ]
  }
];

const SMTP_SETTINGS = {
  note: 'Values live only in Supabase Dashboard; not readable via public API. Reconfigure on new project.',
  dashboardPath: 'Authentication → Emails → SMTP Settings',
  fields: [
    { name: 'Enable Custom SMTP', required: true },
    { name: 'Sender email', required: true },
    { name: 'Sender name', required: false },
    { name: 'Host', required: true },
    { name: 'Port', required: true },
    { name: 'Username', required: true },
    { name: 'Password', required: true, secret: true },
    { name: 'Minimum interval between emails', required: false }
  ],
  authEmailToggles: [
    'Enable Email Signup',
    'Confirm email',
    'Secure email change',
    'Site URL',
    'Redirect URLs (must include VITE_APP_URL / production origins)'
  ],
  appImpact: [
    'signUp confirmation emails',
    'password recovery (resetPasswordForEmail)',
    'resend confirmation',
    'invite-user Edge Function emails'
  ]
};

const OAUTH_SETTINGS = {
  note: 'App currently uses email/password + MFA TOTP. OAuth providers are optional.',
  dashboardPath: 'Authentication → Providers',
  providersDocumented: [
    { id: 'email', enabledInApp: true, notes: 'Primary auth path (signInWithPassword / signUp)' },
    { id: 'phone', enabledInApp: false, notes: 'Not used by LegalMind client' },
    { id: 'google', enabledInApp: false, notes: 'If enabled later: Client ID + Client Secret required' },
    { id: 'github', enabledInApp: false, notes: 'If enabled later: Client ID + Client Secret required' },
    { id: 'azure', enabledInApp: false, notes: 'If enabled later: Client ID + Client Secret + Tenant' }
  ],
  mfa: {
    totp: true,
    notes: 'App uses supabase.auth.mfa (enroll/challenge/verify). MFA factors live in auth schema and sync with auth.users mirror when available.'
  }
};

function parseEnvFileNames(filePath) {
  const present = [];
  if (!fs.existsSync(filePath)) return present;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    present.push({
      name: key,
      configured: val.length > 0,
      isSecret: SECRET_HINT.test(key),
      valuePreview: SECRET_HINT.test(key) ? (val ? '[REDACTED]' : '[EMPTY]') : (val ? maskNonSecret(val) : '[EMPTY]')
    });
  }
  return present;
}

function maskNonSecret(val) {
  if (val.length <= 12) return val;
  if (/^https?:\/\//i.test(val)) return val;
  return `${val.slice(0, 6)}…${val.slice(-4)}`;
}

function localSqlJson(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
  );
  if (res.status !== 0) return { ok: false, error: res.stderr || res.stdout, data: null };
  const raw = (res.stdout || '').trim();
  if (!raw) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: true, data: raw };
  }
}

function remoteSqlJson(sql) {
  const tmp = path.join(process.env.TEMP || '.', `lm-set-${Date.now()}.sql`);
  const out = path.join(process.env.TEMP || '.', `lm-set-${Date.now()}.out`);
  fs.writeFileSync(tmp, sql, 'utf8');
  const res = spawnSync(`npx supabase db query --linked -f "${tmp}" > "${out}" 2> "${out}.err"`, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_INTERNAL_NO_TELEMETRY: '1', PGCLIENTENCODING: 'UTF8' },
    timeout: 25000
  });
  let text = '';
  let errText = '';
  try { text = fs.readFileSync(out, 'utf8'); } catch { /* ignore */ }
  try { errText = fs.readFileSync(`${out}.err`, 'utf8'); } catch { /* ignore */ }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  try { fs.unlinkSync(out); } catch { /* ignore */ }
  try { fs.unlinkSync(`${out}.err`); } catch { /* ignore */ }
  if (/password authentication failed|SUPABASE_DB_PASSWORD|ECIRCUITBREAKER/i.test(errText + text)) {
    return { ok: false, error: 'remote_db_auth_unavailable', rows: [] };
  }
  if (res.status !== 0 && !text.includes('{')) {
    return { ok: false, error: errText.slice(0, 400) || `exit ${res.status}`, rows: [] };
  }
  const start = text.indexOf('{');
  if (start < 0) return { ok: false, error: 'no_json', rows: [] };
  try {
    const parsed = JSON.parse(text.slice(start));
    return { ok: true, rows: parsed.rows || [] };
  } catch {
    return { ok: false, error: 'json_parse', rows: [] };
  }
}

function listEdgeFunctions() {
  const dir = path.join(ROOT, 'supabase', 'functions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# تقرير إعدادات المشروع غير القابلة للاستعادة التلقائية');
  lines.push(`**التاريخ:** ${report.generatedAt}`);
  lines.push(`**الإنتاج:** ${report.projectUrl || '(غير مضبوط)'}`);
  lines.push(`**المصدر:** قراءة محلية + مرآة PostgreSQL فقط (بدون أسرار / بدون تعديل إنتاج)`);
  lines.push('');
  lines.push('## 1) متغيرات البيئة المطلوبة (أسماء فقط)');
  for (const group of report.envCatalog) {
    lines.push('');
    lines.push(`### ${group.group}`);
    lines.push('| المتغير | مطلوب | سرّي | المصدر |');
    lines.push('|---------|-------|------|--------|');
    for (const v of group.vars) {
      lines.push(`| \`${v.name}\` | ${v.required ? 'نعم' : 'لا'} | ${v.secret ? 'نعم' : 'لا'} | ${v.where} |`);
    }
  }
  lines.push('');
  lines.push('### حالة الملفات المحلية (قيم سرّية مُحجوبة)');
  for (const [file, vars] of Object.entries(report.envFilesPresent)) {
    lines.push(`- **${file}**: ${vars.length ? vars.map((v) => `${v.name}=${v.valuePreview}`).join(', ') : '(غير موجود)'}`);
  }
  lines.push('');
  lines.push('## 2) إعدادات SMTP');
  lines.push(`- المسار في اللوحة: ${report.smtp.dashboardPath}`);
  lines.push(`- ملاحظة: ${report.smtp.note}`);
  lines.push('- الحقول:');
  for (const f of report.smtp.fields) {
    lines.push(`  - ${f.name}${f.secret ? ' **(سرّي)**' : ''}${f.required ? ' — مطلوب' : ''}`);
  }
  lines.push('- تبديلات البريد ذات الصلة:');
  for (const t of report.smtp.authEmailToggles) lines.push(`  - ${t}`);
  lines.push('- تأثيرها على التطبيق:');
  for (const a of report.smtp.appImpact) lines.push(`  - ${a}`);
  lines.push('');
  lines.push('## 3) إعدادات OAuth');
  lines.push(`- المسار: ${report.oauth.dashboardPath}`);
  lines.push(`- ${report.oauth.note}`);
  lines.push('| المزوّد | مستخدم في التطبيق | ملاحظات |');
  lines.push('|--------|-------------------|---------|');
  for (const p of report.oauth.providersDocumented) {
    lines.push(`| ${p.id} | ${p.enabledInApp ? 'نعم' : 'لا'} | ${p.notes} |`);
  }
  lines.push(`- MFA TOTP: ${report.oauth.mfa.totp ? 'مُفعّل في التطبيق' : 'لا'} — ${report.oauth.mfa.notes}`);
  lines.push('');
  lines.push('## 4) أسماء Buckets');
  for (const b of report.buckets) {
    lines.push(`- \`${b.id}\` (public=${b.public}, size_limit=${b.file_size_limit ?? 'default'}, mime=${JSON.stringify(b.allowed_mime_types || [])})`);
  }
  if (!report.buckets.length) lines.push('- (لا بيانات — شغّل المزامنة أولاً)');
  lines.push('');
  lines.push('## 5) إعدادات Storage');
  lines.push(JSON.stringify(report.storageSettings, null, 2));
  lines.push('');
  lines.push('## 6) قائمة Extensions');
  if (report.extensions.source) lines.push(`- المصدر: ${report.extensions.source}`);
  for (const e of report.extensions.list || []) {
    lines.push(`- \`${e.name}\` ${e.version || ''}`.trim());
  }
  lines.push('');
  lines.push('## 7) Edge Functions في المستودع');
  for (const f of report.edgeFunctions) lines.push(`- \`${f}\``);
  lines.push('');
  lines.push('## 8) ما لا يُنسخ تلقائياً (أسرار المشروع)');
  for (const x of report.manualOnlySecrets) lines.push(`- ${x}`);
  lines.push('');
  lines.push('## 9) Orphans Storage (إن وُجدت)');
  if (!report.orphans?.length) {
    lines.push('- لا يوجد orphans في آخر نسخة Storage.');
  } else {
    for (const o of report.orphans) {
      lines.push(`- \`${o.bucket}/${o.path}\` — ${o.reason || o.error || 'orphan'}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);

  const report = {
    title: 'LegalMind Yemen — Non-restorable project settings export',
    generatedAt: new Date().toISOString(),
    productionSafe: true,
    projectUrl: config.supabase.url || null,
    envCatalog: ENV_CATALOG,
    envFilesPresent: {
      '.env.local': parseEnvFileNames(path.join(ROOT, '.env.local')),
      '.env.disaster-recovery': parseEnvFileNames(path.join(ROOT, '.env.disaster-recovery'))
    },
    smtp: SMTP_SETTINGS,
    oauth: OAUTH_SETTINGS,
    buckets: [],
    storageSettings: {},
    extensions: { source: null, list: [] },
    edgeFunctions: listEdgeFunctions(),
    orphans: [],
    manualOnlySecrets: [
      'JWT Secret الخاص بالمشروع الجديد (يُولَّد تلقائياً ولا يُنقل من المشروع القديم)',
      'Anon key / Service role key الجديدة',
      'كلمة مرور قاعدة PostgreSQL للمشروع الجديد',
      'SMTP password وبيانات مزوّد البريد',
      'OAuth client secrets (إن وُجدت)',
      'أي Webhook secrets / Stripe secret keys خارج المستودع'
    ]
  };

  const bucketsLocal = localSqlJson(
    config,
    `select coalesce(json_agg(json_build_object(
      'id', id, 'name', name, 'public', public,
      'file_size_limit', file_size_limit,
      'allowed_mime_types', allowed_mime_types
    ) order by id), '[]'::json)::text from storage.buckets`
  );
  if (bucketsLocal.ok && Array.isArray(bucketsLocal.data)) {
    report.buckets = bucketsLocal.data;
  }

  const extLocal = localSqlJson(
    config,
    `select coalesce(json_agg(json_build_object('name', extname, 'version', extversion) order by extname), '[]'::json)::text from pg_extension`
  );
  if (extLocal.ok && Array.isArray(extLocal.data)) {
    report.extensions = { source: 'local_mirror', list: extLocal.data };
  }

  // Remote SQL needs SUPABASE_DB_PASSWORD; skip when missing to avoid long CLI auth loops.
  const canRemoteSql = Boolean(process.env.SUPABASE_DB_PASSWORD) && !process.argv.includes('--local-only');
  let remoteBucketsOk = false;
  if (canRemoteSql) {
    const remoteExt = remoteSqlJson(
      `select json_agg(json_build_object('name', extname, 'version', extversion) order by extname) as extensions from pg_extension`
    );
    if (remoteExt.ok && remoteExt.rows[0]?.extensions) {
      report.extensions = { source: 'remote_sql', list: remoteExt.rows[0].extensions };
    }

    const remoteBuckets = remoteSqlJson(
      `select json_agg(json_build_object(
        'id', id, 'name', name, 'public', public,
        'file_size_limit', file_size_limit,
        'allowed_mime_types', allowed_mime_types
      ) order by id) as buckets from storage.buckets`
    );
    if (remoteBuckets.ok && remoteBuckets.rows[0]?.buckets) {
      report.buckets = remoteBuckets.rows[0].buckets;
      remoteBucketsOk = true;
    }
  } else {
    report.extensions.note = 'remote_sql_skipped_no_SUPABASE_DB_PASSWORD';
  }

  report.storageSettings = {
    inventorySource: remoteBucketsOk ? 'remote_sql' : 'local_mirror',
    bucketCount: report.buckets.length,
    policiesNote: 'Storage RLS policies are in supabase/migrations (replay on new project).',
    serviceRoleDrPolicies: [
      '113_dr_storage_service_role_access.sql',
      '114_fix_storage_policies_service_role_dr.sql'
    ],
    backupPath: config.paths.storage,
    restoreCommand: 'npm run dr:storage-restore -- --source <storage_backup_DIR> --target-url <NEW_URL> --service-role <NEW_KEY>'
  };

  const latestPath = path.join(config.paths.storage, 'LATEST.json');
  if (fs.existsSync(latestPath)) {
    try {
      const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      if (latest.manifestPath && fs.existsSync(latest.manifestPath)) {
        const man = JSON.parse(fs.readFileSync(latest.manifestPath, 'utf8'));
        report.orphans = man.orphans || [];
        report.storageSettings.latestBackup = {
          runDir: latest.runDir,
          createdAt: latest.createdAt,
          totals: latest.totals
        };
      }
    } catch { /* ignore */ }
  }

  // Optional live bucket list via Storage API (names only)
  if (config.supabase.url && config.supabase.serviceRoleKey) {
    try {
      const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data, error } = await supabase.storage.listBuckets();
      if (!error && data) {
        report.storageSettings.apiBuckets = data.map((b) => ({
          id: b.id,
          name: b.name,
          public: b.public,
          fileSizeLimit: b.file_size_limit ?? null,
          allowedMimeTypes: b.allowed_mime_types ?? null
        }));
      }
    } catch (err) {
      report.storageSettings.apiBucketsError = String(err.message || err);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outJson = path.join(config.paths.root, `PROJECT_SETTINGS_${stamp}.json`);
  const outMd = path.join(config.paths.root, 'PROJECT_SETTINGS_LATEST.md');
  const outRepoMd = path.join(ROOT, 'disaster-recovery', 'PROJECT_SETTINGS_EXPORT.md');

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  const md = toMarkdown(report);
  fs.writeFileSync(outMd, md, 'utf8');
  fs.writeFileSync(outRepoMd, md, 'utf8');

  appendSyncLog(config, 'info', 'project_settings_export_ok', {
    outJson,
    outMd,
    bucketCount: report.buckets.length,
    orphanCount: report.orphans.length
  });

  console.log(JSON.stringify({
    ok: true,
    outJson,
    outMd,
    outRepoMd,
    buckets: report.buckets.length,
    extensions: report.extensions.list?.length || 0,
    orphans: report.orphans.length
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
