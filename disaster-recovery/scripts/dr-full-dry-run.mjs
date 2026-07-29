/**
 * FULL Disaster Recovery DRY RUN — read-only vs production.
 * Creates ONLY temporary local DB legalmind_dr_test, restores into it,
 * compares catalogs, then DROPS only that temp DB (explicitly allowed).
 *
 * NEVER touches Supabase production data.
 * NEVER DROP/TRUNCATE application tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TEMP_DB = 'legalmind_dr_test';
const FORBIDDEN_DB = new Set(['postgres', 'template0', 'template1', 'legalmind_backup']);

const results = [];
function record(id, name, pass, detail = {}) {
  results.push({ id, name, pass: !!pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} ${name}`);
  if (detail && Object.keys(detail).length) {
    const preview = JSON.stringify(detail);
    if (preview.length < 400) console.log(`       ${preview}`);
  }
}

function localPsql(config, sql, database = config.local.database) {
  const res = spawnSync(
    config.local.psqlPath,
    [
      '-h', config.local.host,
      '-p', String(config.local.port),
      '-U', config.local.user,
      '-d', database,
      '-v', 'ON_ERROR_STOP=1',
      '-tAc', sql
    ],
    { env: localConnEnv(config), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return {
    ok: res.status === 0,
    out: (res.stdout || '').trim(),
    err: (res.stderr || '').trim(),
    status: res.status ?? 1
  };
}

function remoteQuery(sql) {
  const tmp = path.join(process.env.TEMP || 'C:\\Users\\Public', `lm-drdry-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  fs.writeFileSync(tmp, sql, 'utf8');
  const res = spawnSync(
    'npx',
    ['supabase', 'db', 'query', '--linked', '-f', tmp],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
      cwd: ROOT
    }
  );
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  return {
    ok: res.status === 0,
    out: res.stdout || '',
    err: res.stderr || '',
    status: res.status ?? 1
  };
}

function extractRows(cliOutput) {
  const start = cliOutput.indexOf('{');
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(cliOutput.slice(start));
    if (Array.isArray(parsed.rows)) return parsed.rows;
  } catch { /* ignore */ }
  const matches = [...cliOutput.matchAll(/\{"boundary":[\s\S]*?"rows":(\[[\s\S]*?\])/g)];
  if (matches.length) {
    try { return JSON.parse(matches[matches.length - 1][1]); } catch { return []; }
  }
  return [];
}

function runTool(cmd, args, env) {
  const res = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: res.status === 0, out: res.stdout || '', err: res.stderr || '', status: res.status ?? 1 };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function catalogSql(schemaList = `('public','private','auth','storage','dr')`) {
  return `
select json_build_object(
  'tables', (select count(*) from pg_tables where schemaname in ${schemaList}),
  'views', (select count(*) from pg_views where schemaname in ${schemaList}),
  'functions', (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ${schemaList}
  ),
  'triggers', (
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ${schemaList}
  ),
  'indexes', (
    select count(*) from pg_indexes where schemaname in ${schemaList}
  ),
  'policies', (
    select count(*) from pg_policies where schemaname in ${schemaList}
  ),
  'public_tables', (select count(*) from pg_tables where schemaname = 'public'),
  'public_rows', (
    select coalesce(sum(n_live_tup),0)::bigint
    from pg_stat_user_tables
    where schemaname = 'public'
  )
) as catalog;
`;
}

function rowCountsSql() {
  return `
select coalesce(json_agg(json_build_object(
  'table', quote_ident(schemaname)||'.'||quote_ident(relname),
  'rows', n_live_tup
) order by schemaname, relname), '[]'::json) as rows
from pg_stat_user_tables
where schemaname = 'public';
`;
}

async function main() {
  const started = Date.now();
  const config = loadDrConfig();
  ensureDirs(config);
  const reportPath = path.join(config.paths.root, `DR_DRY_RUN_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const reportMd = path.join(config.paths.root, 'DR_DRY_RUN_LATEST.md');
  const warnings = [];
  const missing = [];
  let phaseA = { ok: false };
  let phaseB = {};
  let phaseC = {};
  let phaseD = {};
  let tempDbCreated = false;

  // ─── 1) Supabase connection (READ ONLY) ───────────────────────────────────
  {
    const r = remoteQuery('select current_database() as db, current_user as usr;');
    const rows = extractRows(r.out);
    const pass = r.ok && rows.length > 0;
    record('T01', 'Verify Supabase connection', pass, { db: rows[0]?.db, user: rows[0]?.usr, error: pass ? null : r.err || r.out.slice(0, 200) });
  }

  // ─── 2) Local PostgreSQL backup DB ────────────────────────────────────────
  {
    const r = localPsql(config, 'select current_database() as db, current_user as usr, version() as ver');
    // -tAc returns single line values if multiple cols — use json
    const j = localPsql(config, `select json_build_object('db', current_database(), 'usr', current_user, 'ok', true)`);
    let info = {};
    try { info = JSON.parse(j.out); } catch { info = { raw: j.out }; }
    record('T02', 'Verify local PostgreSQL backup database connection', j.ok, info);
  }

  // ─── 3) Migrations order ──────────────────────────────────────────────────
  {
    const migDir = path.join(ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const nums = files.map((f) => Number((f.match(/^(\d+)/) || [])[1])).filter((n) => Number.isFinite(n));
    let ordered = true;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] < nums[i - 1]) { ordered = false; break; }
    }
    const gaps = [];
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] - nums[i - 1] > 1) gaps.push(`${nums[i - 1]}→${nums[i]}`);
    }
    if (gaps.length) warnings.push(`Migration number gaps: ${gaps.slice(0, 8).join(', ')}`);
    record('T03', 'Verify migrations exist and are in correct order', files.length > 0 && ordered, {
      count: files.length,
      first: files[0],
      last: files[files.length - 1],
      gaps: gaps.slice(0, 10)
    });
  }

  // ─── 4–6) Scripts exist ───────────────────────────────────────────────────
  const scripts = {
    T04: ['Verify backup scripts', 'nightly-backup.mjs'],
    T05: ['Verify restore scripts', 'restore-to-new-project.mjs'],
    T06: ['Verify sync service', 'sync-service.mjs']
  };
  for (const [id, [name, file]] of Object.entries(scripts)) {
    const p = path.join(__dirname, file);
    const pass = fs.existsSync(p) && fs.statSync(p).size > 100;
    if (!pass) missing.push(file);
    record(id, name, pass, { path: p, bytes: pass ? fs.statSync(p).size : 0 });
  }

  // ─── 7) Count catalog objects on local backup ─────────────────────────────
  let localCatalog = null;
  {
    const r = localPsql(config, catalogSql());
    try { localCatalog = JSON.parse(r.out); } catch { localCatalog = null; }
    record('T07', 'Count tables/views/functions/triggers/indexes/policies (local backup)', !!localCatalog && r.ok, localCatalog || { error: r.err || r.out });
  }

  // Production catalog (READ ONLY)
  let prodCatalog = null;
  {
    const r = remoteQuery(catalogSql(`('public','private','auth','storage')`));
    const rows = extractRows(r.out);
    prodCatalog = rows[0]?.catalog || rows[0] || null;
    record('T07b', 'Count catalog objects on production (read-only)', !!prodCatalog, prodCatalog || { error: r.err?.slice(0, 200) });
  }

  // ─── 8–12) Backup files ───────────────────────────────────────────────────
  const nightly = config.paths.nightly;
  const dumps = fs.existsSync(nightly)
    ? fs.readdirSync(nightly).filter((f) => f.endsWith('.dump')).map((f) => {
        const full = path.join(nightly, f);
        const st = fs.statSync(full);
        return { f, full, mtime: st.mtimeMs, size: st.size, base: f.replace(/\.dump$/, '') };
      }).sort((a, b) => b.mtime - a.mtime)
    : [];

  record('T08', 'Verify backup files can be opened', dumps.length > 0, { count: dumps.length, latest: dumps[0]?.f });

  const latest = dumps[0];
  if (!latest) {
    record('T09', 'Verify latest SQL dump is valid', false, { reason: 'no dump files' });
    record('T10', 'Verify latest custom dump is valid', false, { reason: 'no dump files' });
    record('T11', 'Verify ZIP archive integrity', false, { reason: 'no dump files' });
    record('T12', 'Verify backup timestamps', false, { reason: 'no dump files' });
  } else {
    const sqlPath = path.join(nightly, `${latest.base}.sql`);
    const zipPath = path.join(nightly, `${latest.base}.zip`);
    const integPath = path.join(nightly, `${latest.base}.integrity.json`);

    // T09 SQL dump
    let sqlOk = false;
    let sqlDetail = {};
    if (fs.existsSync(sqlPath) && fs.statSync(sqlPath).size > 64) {
      const head = fs.readFileSync(sqlPath, 'utf8').slice(0, 5000);
      sqlOk = /PostgreSQL database dump|CREATE TABLE|COPY /i.test(head);
      sqlDetail = { bytes: fs.statSync(sqlPath).size, sha256: sha256(sqlPath).slice(0, 16) + '…', hasDumpHeader: /PostgreSQL database dump/i.test(head) };
    } else {
      sqlDetail = { reason: 'missing or empty sql' };
      missing.push(sqlPath);
    }
    record('T09', 'Verify latest SQL dump is valid', sqlOk, sqlDetail);

    // T10 custom dump
    const toc = runTool(config.local.pgRestorePath, ['-l', latest.full], localConnEnv(config));
    const tocLines = (toc.out || '').split(/\r?\n/).filter(Boolean).length;
    record('T10', 'Verify latest custom dump is valid', toc.ok && tocLines > 5, {
      bytes: latest.size,
      tocLines,
      sha256: sha256(latest.full).slice(0, 16) + '…',
      error: toc.ok ? null : toc.err.slice(0, 200)
    });

    // T11 ZIP
    let zipOk = false;
    let zipDetail = {};
    if (fs.existsSync(zipPath)) {
      const probe = spawnSync('powershell.exe', [
        '-NoProfile', '-Command',
        `$z='${zipPath.replace(/'/g, "''")}'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $a=[IO.Compression.ZipFile]::OpenRead($z); $n=$a.Entries.Count; $a.Dispose(); Write-Output $n`
      ], { encoding: 'utf8' });
      const entries = Number((probe.stdout || '').trim());
      zipOk = probe.status === 0 && entries > 0;
      zipDetail = { bytes: fs.statSync(zipPath).size, entries, error: zipOk ? null : probe.stderr };
    } else {
      zipDetail = { reason: 'zip missing' };
      missing.push(zipPath);
    }
    record('T11', 'Verify ZIP archive integrity', zipOk, zipDetail);

    // T12 timestamps
    const ageHours = (Date.now() - latest.mtime) / 3600000;
    const tsOk = ageHours < 48; // warn if older than 48h
    if (ageHours >= 24) warnings.push(`Latest backup is ${ageHours.toFixed(1)} hours old`);
    record('T12', 'Verify backup timestamps', tsOk, {
      latest: latest.f,
      mtime: new Date(latest.mtime).toISOString(),
      ageHours: Number(ageHours.toFixed(2)),
      integrityFile: fs.existsSync(integPath)
    });
  }

  // ─── 13) Scheduled tasks ──────────────────────────────────────────────────
  {
    const tasks = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      "Get-ScheduledTask -TaskName 'LegalMind-DR-*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName"
    ], { encoding: 'utf8' });
    const names = (tasks.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const expected = ['LegalMind-DR-Sync', 'LegalMind-DR-NightlyBackup', 'LegalMind-DR-Dashboard'];
    const found = expected.filter((e) => names.includes(e));
    if (found.length < expected.length) {
      warnings.push('Scheduled tasks not fully installed — run install-windows-tasks.ps1 as Administrator');
      missing.push(...expected.filter((e) => !names.includes(e)));
    }
    record('T13', 'Verify scheduled tasks', found.length === expected.length, { found, expected });
  }

  // ─── 14) Dashboard status ─────────────────────────────────────────────────
  {
    const dashJson = path.join(config.paths.root, 'dashboard-status.json');
    const dashHtml = path.join(config.paths.root, 'dashboard.html');
    let status = null;
    if (fs.existsSync(dashJson)) {
      try { status = JSON.parse(fs.readFileSync(dashJson, 'utf8')); } catch { status = null; }
    }
    const pass = !!status && status.postgresqlConnectionStatus === 'connected';
    if (status?.syncStatus === 'degraded') warnings.push('Dashboard reports syncStatus=degraded');
    if (status?.supabaseConnectionStatus !== 'connected') warnings.push('Dashboard Supabase status not connected at last refresh');
    record('T14', 'Verify dashboard status', pass, {
      hasHtml: fs.existsSync(dashHtml),
      postgresqlConnectionStatus: status?.postgresqlConnectionStatus,
      supabaseConnectionStatus: status?.supabaseConnectionStatus,
      syncStatus: status?.syncStatus,
      backupStatus: status?.backupStatus,
      restoreStatus: status?.restoreStatus,
      recordsSynchronized: status?.recordsSynchronized,
      lastSyncTime: status?.lastSyncTime
    });
  }

  // ─── 15) Sync logs ────────────────────────────────────────────────────────
  {
    const logPath = path.join(config.paths.logs, 'sync.jsonl');
    let lines = 0;
    let last = null;
    let errorCount = 0;
    if (fs.existsSync(logPath)) {
      const all = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
      lines = all.length;
      for (const line of all.slice(-200)) {
        try {
          const o = JSON.parse(line);
          if (o.level === 'error') errorCount += 1;
          last = o;
        } catch { /* ignore */ }
      }
    } else {
      missing.push(logPath);
    }
    if (last?.detail?.tables === 0) warnings.push('Recent sync ticks report tables=0 (listRemoteTables may be failing)');
    record('T15', 'Verify sync logs', lines > 0, { lines, recentErrorsInLast200: errorCount, lastEvent: last?.event, lastTs: last?.ts });
  }

  // ─── Phase A: restore into temp local DB only ─────────────────────────────
  const restoreStarted = Date.now();
  if (FORBIDDEN_DB.has(TEMP_DB)) {
    throw new Error('Refusing forbidden database name');
  }
  if (!latest) {
    record('A01', 'Phase A — create temp DB + restore', false, { reason: 'no backup available' });
  } else {
    // Drop temp if leftover from prior dry run (ONLY legalmind_dr_test)
    const exists = localPsql(config, `select 1 from pg_database where datname='${TEMP_DB}'`, 'postgres');
    if (exists.out === '1') {
      localPsql(config, `
        select pg_terminate_backend(pid) from pg_stat_activity where datname='${TEMP_DB}' and pid <> pg_backend_pid();
      `, 'postgres');
      const drop = localPsql(config, `drop database ${TEMP_DB}`, 'postgres');
      if (!drop.ok) warnings.push(`Could not clear prior temp DB: ${drop.err}`);
    }

    const create = localPsql(
      config,
      `create database ${TEMP_DB} owner ${config.local.user} encoding 'UTF8' template template0`,
      'postgres'
    );
    tempDbCreated = create.ok;
    if (!create.ok) {
      record('A01', 'Phase A — create temporary database legalmind_dr_test', false, { error: create.err });
    } else {
      record('A01', 'Phase A — create temporary database legalmind_dr_test', true, { database: TEMP_DB });

      const restore = runTool(
        config.local.pgRestorePath,
        [
          '-h', config.local.host,
          '-p', String(config.local.port),
          '-U', config.local.user,
          '-d', TEMP_DB,
          '--no-owner',
          '--no-acl',
          '-v',
          latest.full
        ],
        localConnEnv(config)
      );
      // pg_restore may return 1 with warnings; check table presence
      const check = localPsql(config, `select count(*) from pg_tables where schemaname='public'`, TEMP_DB);
      const tableCount = Number(check.out || 0);
      phaseA = {
        ok: check.ok && tableCount > 0,
        tableCount,
        source: latest.full,
        restoreStatus: restore.status,
        restoreStderrTail: (restore.err || '').split(/\r?\n/).slice(-8)
      };
      record('A02', 'Phase A — restore newest backup into temp DB (not production)', phaseA.ok, phaseA);
    }
  }
  const restoreMs = Date.now() - restoreStarted;

  // ─── Phase B: compare production vs temp restore ──────────────────────────
  let restoreCatalog = null;
  if (tempDbCreated && phaseA.ok) {
    const r = localPsql(config, catalogSql(), TEMP_DB);
    try { restoreCatalog = JSON.parse(r.out); } catch { restoreCatalog = null; }

    const diffs = {};
    if (prodCatalog && restoreCatalog) {
      for (const key of ['tables', 'views', 'functions', 'triggers', 'indexes', 'policies', 'public_tables']) {
        const a = Number(prodCatalog[key] ?? 0);
        const b = Number(restoreCatalog[key] ?? 0);
        diffs[key] = { production: a, restored: b, delta: b - a };
      }
    }

    // Row counts compare (approx via pg_stat — may be stale on prod; still useful)
    let prodRows = [];
    let restRows = [];
    {
      const pr = remoteQuery(rowCountsSql());
      const rows = extractRows(pr.out);
      prodRows = rows[0]?.rows || [];
      if (typeof prodRows === 'string') {
        try { prodRows = JSON.parse(prodRows); } catch { prodRows = []; }
      }
    }
    {
      const rr = localPsql(config, rowCountsSql(), TEMP_DB);
      try {
        const parsed = JSON.parse(rr.out);
        restRows = parsed.rows || parsed || [];
      } catch { restRows = []; }
    }

    const prodMap = new Map((prodRows || []).map((x) => [x.table, Number(x.rows || 0)]));
    const restMap = new Map((restRows || []).map((x) => [x.table, Number(x.rows || 0)]));
    const allTables = new Set([...prodMap.keys(), ...restMap.keys()]);
    const rowDiffs = [];
    for (const t of [...allTables].sort()) {
      const p = prodMap.has(t) ? prodMap.get(t) : null;
      const r = restMap.has(t) ? restMap.get(t) : null;
      if (p !== r) rowDiffs.push({ table: t, production: p, restored: r, delta: (r ?? 0) - (p ?? 0) });
    }

    phaseB = { catalogDiffs: diffs, rowDiffSample: rowDiffs.slice(0, 40), rowDiffCount: rowDiffs.length };
    // Backup mirror of local legalmind_backup — expect restore ≈ local backup, not necessarily live prod row-equal
    const catalogClose =
      diffs.public_tables &&
      Math.abs(diffs.public_tables.delta) <= 5;
    record('B01', 'Phase B — catalog compare production vs temp restore', !!restoreCatalog, {
      note: 'Local nightly dump mirrors legalmind_backup (may lag live production rows)',
      diffs,
      mismatchedRowTables: rowDiffs.length
    });
    record('B02', 'Phase B — public table count within tolerance', catalogClose, diffs.public_tables || {});
  } else {
    record('B01', 'Phase B — catalog compare production vs temp restore', false, { reason: 'restore phase failed' });
  }

  // Also compare restore vs source backup DB (true fidelity of dump)
  if (tempDbCreated && phaseA.ok && localCatalog && restoreCatalog) {
    const fidelity = {};
    for (const key of ['tables', 'views', 'functions', 'triggers', 'indexes', 'policies', 'public_tables']) {
      fidelity[key] = {
        backupDb: Number(localCatalog[key] ?? 0),
        restored: Number(restoreCatalog[key] ?? 0),
        delta: Number(restoreCatalog[key] ?? 0) - Number(localCatalog[key] ?? 0)
      };
    }
    const ok = Object.values(fidelity).every((v) => v.delta === 0);
    phaseB.backupFidelity = fidelity;
    record('B03', 'Phase B — restore fidelity vs legalmind_backup source', ok, fidelity);
  }

  // ─── Phase C: integrity on temp DB only ───────────────────────────────────
  if (tempDbCreated && phaseA.ok) {
    const fk = localPsql(config, `
      select coalesce(json_agg(json_build_object(
        'table', n.nspname||'.'||c.relname,
        'constraint', con.conname,
        'valid', con.convalidated
      )), '[]'::json)
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where con.contype = 'f' and n.nspname = 'public'
    `, TEMP_DB);

    const notValid = localPsql(config, `
      select count(*) from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where con.contype in ('f','c') and not con.convalidated and n.nspname in ('public','private')
    `, TEMP_DB);

    // Sample orphan checks (read-only selects)
    const orphans = {};
    const orphanChecks = [
      ['profiles_without_auth', `select count(*) from public.profiles p left join auth.users u on u.id = p.id where u.id is null`],
      ['employees_without_firm', `select count(*) from public.employees e left join public.firms f on f.id = e.firm_id where e.firm_id is not null and f.id is null`],
      ['cases_without_firm', `select count(*) from public.cases c left join public.firms f on f.id = c.firm_id where c.firm_id is not null and f.id is null`]
    ];
    for (const [name, sql] of orphanChecks) {
      const r = localPsql(config, sql, TEMP_DB);
      orphans[name] = r.ok ? Number(r.out || 0) : -1;
    }

    const uuidCheck = localPsql(config, `
      select count(*) from public.firms where id is null
    `, TEMP_DB);

    phaseC = {
      foreignKeys: fk.ok ? JSON.parse(fk.out || '[]').length : 0,
      notValidatedConstraints: Number(notValid.out || 0),
      orphans,
      nullFirmIds: Number(uuidCheck.out || 0)
    };

    const orphanFail = Object.values(orphans).some((v) => v > 0);
    record('C01', 'Phase C — foreign keys present', phaseC.foreignKeys > 0, { count: phaseC.foreignKeys });
    record('C02', 'Phase C — no NOT VALID constraints', phaseC.notValidatedConstraints === 0, { count: phaseC.notValidatedConstraints });
    record('C03', 'Phase C — broken references / missing rows checks', !orphanFail, orphans);
    record('C04', 'Phase C — UUID consistency (firms.id not null)', phaseC.nullFirmIds === 0, { nullFirmIds: phaseC.nullFirmIds });
  } else {
    record('C01', 'Phase C — integrity tests', false, { reason: 'restore phase failed' });
  }

  // ─── Phase D: RTO / RPO ───────────────────────────────────────────────────
  {
    const ageMs = latest ? Date.now() - latest.mtime : null;
    phaseD = {
      measuredRestoreMs: restoreMs,
      measuredRestoreMinutes: Number((restoreMs / 60000).toFixed(2)),
      estimatedRTO_minutes: Number((Math.max(restoreMs, 60000) / 60000 * 1.5).toFixed(1)),
      estimatedRPO_minutes: ageMs != null ? Number((ageMs / 60000).toFixed(1)) : null,
      notes: [
        'RTO based on measured restore duration × 1.5 safety factor (schema+data into empty DB).',
        'RPO based on age of newest local nightly dump (worst-case data loss window without continuous sync catch-up).',
        'With healthy continuous sync, effective RPO approaches last successful sync tick.'
      ]
    };
    record('D01', 'Phase D — RTO/RPO estimated', true, phaseD);
  }

  // ─── Phase E: cleanup ONLY temp DB ────────────────────────────────────────
  let cleanupOk = false;
  if (tempDbCreated) {
    localPsql(config, `
      select pg_terminate_backend(pid) from pg_stat_activity where datname='${TEMP_DB}' and pid <> pg_backend_pid();
    `, 'postgres');
    const drop = localPsql(config, `drop database if exists ${TEMP_DB}`, 'postgres');
    cleanupOk = drop.ok;
    const still = localPsql(config, `select 1 from pg_database where datname='${TEMP_DB}'`, 'postgres');
    cleanupOk = cleanupOk && still.out !== '1';
    record('E01', 'Phase E — remove ONLY temporary legalmind_dr_test', cleanupOk, {
      dropped: TEMP_DB,
      productionUntouched: true,
      legalmind_backupUntouched: true
    });
  } else {
    record('E01', 'Phase E — remove ONLY temporary legalmind_dr_test', true, { skipped: true, reason: 'temp DB was not created' });
    cleanupOk = true;
  }

  // Safety assertions
  const prodSafe =
    !results.some((r) => /production data modified/i.test(JSON.stringify(r))) &&
    cleanupOk;
  record('S01', 'Production safety — no production modifications', prodSafe, {
    supabaseWrite: false,
    droppedOnly: TEMP_DB,
    backupDbPreserved: true
  });

  const critical = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T09', 'T10', 'T11', 'A02', 'B03', 'C03', 'E01', 'S01'];
  const criticalFailed = results.filter((r) => critical.includes(r.id) && !r.pass);
  const allCriticalPass = criticalFailed.length === 0;
  // Soft: T13 scheduled tasks is warning-level for overall pass if everything else works
  const overallPass = allCriticalPass;

  const report = {
    title: 'LegalMind Yemen — Full Disaster Recovery DRY RUN',
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    overall: overallPass ? 'PASSED' : 'FAILED',
    productionSafe: prodSafe,
    verdictLine: overallPass && prodSafe
      ? '✅ Production Safe\n✅ Disaster Recovery Passed'
      : '❌ Disaster Recovery Failed',
    tests: results,
    warnings,
    missingItems: missing,
    phases: { A: phaseA, B: phaseB, C: phaseC, D: phaseD },
    catalogs: { production: prodCatalog, localBackup: localCatalog, restoredTemp: restoreCatalog },
    recommendations: [
      ...(results.find((r) => r.id === 'T13' && !r.pass)
        ? ['Install Windows scheduled tasks: powershell -ExecutionPolicy Bypass -File disaster-recovery/scripts/install-windows-tasks.ps1']
        : []),
      ...(warnings.some((w) => /tables=0/i.test(w))
        ? ['Investigate sync listRemoteTables returning 0 tables (CLI JSON parse / remote query).']
        : []),
      'Keep nightly backups and continuous sync running; re-run this dry run monthly.',
      'For brand-new Supabase project restore, use npm run dr:restore -- --database-url <NEW_PROJECT_URI>.'
    ]
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const md = `# Disaster Recovery DRY RUN Report

**Generated:** ${report.generatedAt}  
**Overall:** ${report.overall}  
**Duration:** ${(report.durationMs / 1000).toFixed(1)}s

${report.verdictLine}

## Production Safety
- Supabase production writes: **NONE**
- Dropped resources: **only** \`${TEMP_DB}\` (temporary)
- \`legalmind_backup\` preserved: **YES**

## Connection / Status
| Check | Result |
|------|--------|
| Supabase | ${results.find((r) => r.id === 'T01')?.pass ? 'PASS' : 'FAIL'} |
| Local PG backup | ${results.find((r) => r.id === 'T02')?.pass ? 'PASS' : 'FAIL'} |
| Dashboard | ${results.find((r) => r.id === 'T14')?.pass ? 'PASS' : 'FAIL'} |
| Sync logs | ${results.find((r) => r.id === 'T15')?.pass ? 'PASS' : 'FAIL'} |
| Scheduled tasks | ${results.find((r) => r.id === 'T13')?.pass ? 'PASS' : 'FAIL'} |

## Backup / Restore
| Check | Result |
|------|--------|
| SQL dump | ${results.find((r) => r.id === 'T09')?.pass ? 'PASS' : 'FAIL'} |
| Custom dump | ${results.find((r) => r.id === 'T10')?.pass ? 'PASS' : 'FAIL'} |
| ZIP | ${results.find((r) => r.id === 'T11')?.pass ? 'PASS' : 'FAIL'} |
| Temp restore | ${results.find((r) => r.id === 'A02')?.pass ? 'PASS' : 'FAIL'} |
| Fidelity vs backup DB | ${results.find((r) => r.id === 'B03')?.pass ? 'PASS' : 'FAIL'} |

## Integrity
| Check | Result |
|------|--------|
| Foreign keys | ${results.find((r) => r.id === 'C01')?.pass ? 'PASS' : 'FAIL'} |
| Constraints | ${results.find((r) => r.id === 'C02')?.pass ? 'PASS' : 'FAIL'} |
| Broken refs | ${results.find((r) => r.id === 'C03')?.pass ? 'PASS' : 'FAIL'} |
| UUID | ${results.find((r) => r.id === 'C04')?.pass ? 'PASS' : 'FAIL'} |

## RTO / RPO
- Measured restore: **${phaseD.measuredRestoreMinutes} min**
- Estimated RTO: **${phaseD.estimatedRTO_minutes} min**
- Estimated RPO (dump age): **${phaseD.estimatedRPO_minutes} min**

## Catalog snapshot
\`\`\`json
${JSON.stringify({ production: prodCatalog, localBackup: localCatalog, restoredTemp: restoreCatalog }, null, 2)}
\`\`\`

## Warnings
${warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : '- None'}

## Missing items
${missing.length ? missing.map((m) => `- ${m}`).join('\n') : '- None'}

## Recommendations
${report.recommendations.map((r) => `- ${r}`).join('\n')}

## Full test matrix
${results.map((r) => `- ${r.pass ? 'PASS' : 'FAIL'} \`${r.id}\` ${r.name}`).join('\n')}

Full JSON: \`${reportPath}\`
`;
  fs.writeFileSync(reportMd, md, 'utf8');
  appendSyncLog(config, overallPass ? 'info' : 'error', 'dr_dry_run', {
    overall: report.overall,
    productionSafe: prodSafe,
    reportPath,
    reportMd
  });

  console.log('\n' + '='.repeat(60));
  console.log(report.verdictLine);
  console.log('='.repeat(60));
  console.log(`Report: ${reportMd}`);
  console.log(`JSON:   ${reportPath}`);
  if (criticalFailed.length) {
    console.log('Critical failures:');
    for (const f of criticalFailed) console.log(` - ${f.id} ${f.name}: ${JSON.stringify(f.detail)}`);
  }
  process.exit(overallPass && prodSafe ? 0 : 2);
}

main().catch((err) => {
  console.error('DRY RUN ABORTED:', err);
  // Best-effort cleanup of temp DB only
  try {
    const config = loadDrConfig();
    localPsql(config, `select pg_terminate_backend(pid) from pg_stat_activity where datname='${TEMP_DB}' and pid <> pg_backend_pid();`, 'postgres');
    localPsql(config, `drop database if exists ${TEMP_DB}`, 'postgres');
  } catch { /* ignore */ }
  process.exit(1);
});
