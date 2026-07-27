/**
 * Emit DR dashboard status JSON (and optionally write status.html).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadDrConfig, ensureDirs, localConnEnv } from './lib/config.mjs';

function psqlJson(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
  );
  if (res.status !== 0) return null;
  const raw = (res.stdout || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);

  let localOk = false;
  try {
    localOk = psqlJson(config, 'select true') === true || psqlJson(config, 'select true::text') === 'true';
    if (!localOk) {
      const t = spawnSync(
        config.local.psqlPath,
        ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', 'select 1'],
        { env: localConnEnv(config), encoding: 'utf8' }
      );
      localOk = (t.stdout || '').trim() === '1';
    }
  } catch {
    localOk = false;
  }

  let supabaseOk = false;
  if (config.supabase.url && config.supabase.serviceRoleKey) {
    const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error } = await supabase.from('firms').select('id').limit(1);
    supabaseOk = !error;
  }

  const syncState = psqlJson(
    config,
    `select coalesce(json_agg(row_to_json(s) order by updated_at desc), '[]'::json)
     from dr.sync_state s`
  ) || [];

  const lastSync = psqlJson(
    config,
    `select to_json(t) from (
       select max(last_synced_at) as last_sync_time,
              sum(rows_synced)::bigint as records_synchronized,
              count(*) filter (where status='error')::int as error_tables
       from dr.sync_state
     ) t`
  ) || {};

  const recentErrors = psqlJson(
    config,
    `select coalesce(json_agg(row_to_json(l)), '[]'::json) from (
       select level, event, detail, created_at from dr.sync_log
       where level in ('error','warn') order by id desc limit 20
     ) l`
  ) || [];

  const backupStatus = psqlJson(
    config,
    `select to_json(b) from (
       select * from dr.backup_runs order by started_at desc limit 1
     ) b`
  );

  const restoreStatus = psqlJson(
    config,
    `select to_json(r) from (
       select * from dr.restore_runs order by started_at desc limit 1
     ) r`
  );

  let fileStatus = null;
  const statusFile = path.join(config.paths.sync, 'last-status.json');
  if (fs.existsSync(statusFile)) {
    fileStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  }

  const nightlyCount = fs.existsSync(config.paths.nightly)
    ? fs.readdirSync(config.paths.nightly).filter((f) => f.endsWith('.zip')).length
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    postgresqlConnectionStatus: localOk ? 'connected' : 'down',
    supabaseConnectionStatus: supabaseOk ? 'connected' : 'down_or_unconfigured',
    lastSyncTime: lastSync.last_sync_time || fileStatus?.ts || null,
    syncStatus: (lastSync.error_tables || 0) > 0 ? 'degraded' : fileStatus ? 'ok' : 'idle',
    backupStatus: backupStatus?.status || 'none',
    restoreStatus: restoreStatus?.status || 'none',
    recordsSynchronized: Number(lastSync.records_synchronized || fileStatus?.rowsSynced || 0),
    synchronizationErrors: recentErrors,
    tables: syncState,
    nightlyBackupCount: nightlyCount,
    lastBackup: backupStatus,
    lastRestore: restoreStatus,
    fileTick: fileStatus
  };

  const outJson = path.join(config.paths.root, 'dashboard-status.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="refresh" content="30"/>
  <title>LegalMind DR Dashboard</title>
  <style>
    body{font-family:Cairo,Segoe UI,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
    h1{margin:0 0 8px;font-size:28px}
    .sub{color:#94a3b8;margin-bottom:24px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
    .card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:16px}
    .label{font-size:12px;color:#94a3b8}
    .value{font-size:22px;font-weight:800;margin-top:6px}
    .ok{color:#34d399}.bad{color:#fb7185}.warn{color:#fbbf24}
    pre{background:#020617;padding:12px;border-radius:12px;overflow:auto;font-size:12px}
  </style>
</head>
<body>
  <h1>لوحة النسخ الاحتياطي والتعافي</h1>
  <p class="sub">LegalMind Yemen · يُحدّث كل 30 ثانية · ${report.generatedAt}</p>
  <div class="grid">
    <div class="card"><div class="label">PostgreSQL المحلي</div><div class="value ${localOk?'ok':'bad'}">${report.postgresqlConnectionStatus}</div></div>
    <div class="card"><div class="label">Supabase</div><div class="value ${supabaseOk?'ok':'bad'}">${report.supabaseConnectionStatus}</div></div>
    <div class="card"><div class="label">آخر مزامنة</div><div class="value">${report.lastSyncTime || '—'}</div></div>
    <div class="card"><div class="label">حالة المزامنة</div><div class="value">${report.syncStatus}</div></div>
    <div class="card"><div class="label">سجلات مُزامَنة</div><div class="value">${report.recordsSynchronized}</div></div>
    <div class="card"><div class="label">النسخ الليلي</div><div class="value">${report.backupStatus} (${nightlyCount})</div></div>
    <div class="card"><div class="label">الاستعادة</div><div class="value">${report.restoreStatus}</div></div>
    <div class="card"><div class="label">أخطاء حديثة</div><div class="value ${recentErrors.length?'warn':'ok'}">${recentErrors.length}</div></div>
  </div>
  <h2 style="margin-top:28px">التفاصيل</h2>
  <pre>${JSON.stringify(report, null, 2).replace(/</g, '&lt;')}</pre>
</body>
</html>`;
  const outHtml = path.join(config.paths.root, 'dashboard.html');
  fs.writeFileSync(outHtml, html, 'utf8');
  console.log(JSON.stringify({ ok: true, outJson, outHtml, ...report }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
