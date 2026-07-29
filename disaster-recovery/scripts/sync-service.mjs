/**
 * Supabase → local PostgreSQL mirror refresh (READ production only).
 *
 * Default / recommended: --once (used by daily backup; process exits).
 * Continuous polling is DISABLED unless --allow-continuous is passed
 * (not used by Task Scheduler — low-resource mode).
 *
 * Design:
 * - Table list comes from LOCAL backup DB (authoritative mirror inventory).
 * - Data is pulled READ-ONLY from linked Supabase via serialized CLI queries.
 * - Upserts use session_replication_role=replica to avoid FK ordering loss.
 * - Failures go to dr.sync_outbox with exponential backoff (never dropped).
 *
 * Usage: node sync-service.mjs --once
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const PRIORITY = [
  'auth.users',
  'public.firms',
  'public.firm_roles',
  'public.firm_codes',
  'public.employees',
  'public.profiles',
  'public.lawyers',
  'public.clients',
  'public.cases',
  'public.case_sessions',
  'public.sessions',
  'public.documents',
  'storage.buckets',
  'storage.objects'
];

const SKIP_LOCAL = new Set([
  'schema_migrations',
  'schema_migrations_history'
]);

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${Math.max(0, ms)})`], {
    stdio: 'ignore',
    windowsHide: true
  });
}

function localPsql(config, sql) {
  const tmp = path.join(
    process.env.TEMP || config.paths.sync,
    `lm-local-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`
  );
  // UTF-8 with BOM helps Windows psql honor Unicode for Arabic enums
  fs.writeFileSync(tmp, `\uFEFFset client_encoding to 'UTF8';\n${sql}\n`, { encoding: 'utf8' });
  const res = spawnSync(
    config.local.psqlPath,
    [
      '-h', config.local.host,
      '-p', String(config.local.port),
      '-U', config.local.user,
      '-d', config.local.database,
      '-v', 'ON_ERROR_STOP=1',
      '-f', tmp
    ],
    {
      env: {
        ...localConnEnv(config),
        PGCLIENTENCODING: 'UTF8',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8'
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    }
  );
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'local psql failed');
  return (res.stdout || '').trim();
}

function localPsqlScalar(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    [
      '-h', config.local.host,
      '-p', String(config.local.port),
      '-U', config.local.user,
      '-d', config.local.database,
      '-v', 'ON_ERROR_STOP=1',
      '-tAc', sql
    ],
    {
      env: {
        ...localConnEnv(config),
        PGCLIENTENCODING: 'UTF8'
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    }
  );
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'local psql failed');
  return (res.stdout || '').trim();
}

/** Cross-process lock so concurrent supabase CLI calls do not corrupt telemetry.json */
function withCliLock(config, fn) {
  const lockPath = path.join(config.paths.sync, 'supabase-cli.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - started > 120000) {
        // Stale lock recovery (no delete of data — only the lock file)
        try {
          const age = Date.now() - fs.statSync(lockPath).mtimeMs;
          if (age > 180000) fs.unlinkSync(lockPath);
        } catch { /* ignore */ }
      }
      sleep(250);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

function remoteQuery(config, sqlText) {
  const stamp = `${process.pid}-${Date.now()}`;
  const tmp = path.join(process.env.TEMP || config.paths.sync, `lm-sync-${stamp}.sql`);
  const outFile = path.join(process.env.TEMP || config.paths.sync, `lm-sync-${stamp}.out.json`);
  // UTF-8 without BOM
  fs.writeFileSync(tmp, sqlText, { encoding: 'utf8' });

  return withCliLock(config, () => {
    let last = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch { /* ignore */ }

      // Redirect to file to preserve UTF-8 Arabic on Windows consoles
      const cmd = `npx supabase db query --linked -f "${tmp}" > "${outFile}" 2> "${outFile}.err"`;
      const res = spawnSync(cmd, {
        encoding: 'utf8',
        cwd: ROOT,
        windowsHide: true,
        shell: true,
        env: {
          ...process.env,
          SUPABASE_INTERNAL_NO_TELEMETRY: '1',
          PGCLIENTENCODING: 'UTF8',
          PYTHONUTF8: '1',
          LANG: 'C.UTF-8'
        }
      });
      last = res;
      let out = '';
      let err = '';
      try { out = fs.readFileSync(outFile, 'utf8'); } catch { out = res.stdout || ''; }
      try { err = fs.readFileSync(`${outFile}.err`, 'utf8'); } catch { err = res.stderr || ''; }
      // npm/devdir warnings are noise — not sync failures
      const errClean = String(err)
        .split(/\r?\n/)
        .filter((l) => !/npm warn|Unknown env config|new version of Supabase CLI|updating the supabase cli|Initialising login role/i.test(l))
        .join('\n')
        .trim();
      const combined = `${out}\n${errClean}`;
      const busy = /EPERM|telemetry\.json\.tmp|operation not permitted/i.test(combined);
      const hasPayload = /"boundary"\s*:/.test(out) && /"rows"\s*:/.test(out);
      if (hasPayload && !busy) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        try { fs.unlinkSync(outFile); } catch { /* ignore */ }
        try { fs.unlinkSync(`${outFile}.err`); } catch { /* ignore */ }
        return out;
      }
      if (!busy && !hasPayload) {
        last = { status: res.status, stderr: errClean || out.slice(0, 500), stdout: out.slice(0, 200) };
        // keep retrying a couple times for empty/transient CLI output
      }
      sleep(400 * attempt);
    }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    try { fs.unlinkSync(outFile); } catch { /* ignore */ }
    try { fs.unlinkSync(`${outFile}.err`); } catch { /* ignore */ }
    throw new Error(last?.stderr || last?.stdout || 'remote query failed');
  });
}

function extractCliRows(cliOutput) {
  const text = String(cliOutput || '');
  const starts = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '{') starts.push(i);
  for (let s = starts.length - 1; s >= 0; s--) {
    const slice = text.slice(starts[s]);
    // Bound search — avoid O(n^2) on multi‑MB payloads
    const maxEnd = Math.min(slice.length, 5_000_000);
    for (let end = maxEnd; end > 2; end--) {
      if (slice[end - 1] !== '}') continue;
      try {
        const parsed = JSON.parse(slice.slice(0, end));
        // Prefer official supabase db query envelope
        if (parsed && typeof parsed.boundary === 'string' && Array.isArray(parsed.rows)) {
          return parsed.rows;
        }
      } catch {
        /* keep shrinking */
      }
      // Jump back to previous } to speed up
      const prev = slice.lastIndexOf('}', end - 2);
      if (prev < 0) break;
      end = prev + 1;
    }
  }
  // Fallback: first JSON object with rows[] (legacy)
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (Array.isArray(parsed?.rows)) return parsed.rows;
    } catch { /* ignore */ }
  }
  return [];
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) {
    // Prefer Postgres text[] / generic array literal (not jsonb)
    const parts = value.map((v) => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      if (typeof v === 'object') return sqlLiteral(JSON.stringify(v));
      return sqlLiteral(String(v));
    });
    return `ARRAY[${parts.join(', ')}]`;
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function localColumns(config, schema, table) {
  const raw = localPsqlScalar(
    config,
    `select coalesce(json_agg(column_name), '[]'::json)::text
     from information_schema.columns
     where table_schema = '${schema.replace(/'/g, "''")}'
       and table_name = '${table.replace(/'/g, "''")}'
       and is_generated = 'NEVER'`
  );
  try {
    return new Set(JSON.parse(raw || '[]'));
  } catch {
    return new Set();
  }
}

function upsertRow(config, schema, table, row, colCache) {
  const key = `${schema}.${table}`;
  if (!colCache.has(key)) colCache.set(key, localColumns(config, schema, table));
  const localCols = colCache.get(key);
  const cols = Object.keys(row).filter((c) => !localCols.size || localCols.has(c));
  if (!cols.length) return;
  const colList = cols.map(quoteIdent).join(', ');
  const values = cols.map((c) => sqlLiteral(row[c])).join(', ');
  const conflict = cols.includes('id') ? 'id' : cols[0];
  const updates = cols
    .filter((c) => c !== conflict)
    .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
    .join(', ');
  const sql = updates
    ? `set session_replication_role = replica; insert into ${quoteIdent(schema)}.${quoteIdent(table)} (${colList}) values (${values}) on conflict (${quoteIdent(conflict)}) do update set ${updates};`
    : `set session_replication_role = replica; insert into ${quoteIdent(schema)}.${quoteIdent(table)} (${colList}) values (${values}) on conflict do nothing;`;
  localPsql(config, sql);
}

function updateSyncState(config, table, patch) {
  localPsql(
    config,
    `insert into dr.sync_state(table_name, last_synced_at, rows_synced, status, last_error, updated_at)
     values ('${table.replace(/'/g, "''")}', now(), ${Number(patch.rows_synced || 0)},
       '${String(patch.status || 'ok').replace(/'/g, "''")}',
       ${patch.last_error != null ? sqlLiteral(String(patch.last_error)) : 'NULL'}, now())
     on conflict (table_schema, table_name) do update set
       last_synced_at = now(),
       rows_synced = dr.sync_state.rows_synced + excluded.rows_synced,
       status = excluded.status,
       last_error = excluded.last_error,
       updated_at = now();`
  );
}

/** Authoritative inventory = what exists locally to be mirrored */
function listLocalMirrorTables(config) {
  const raw = localPsqlScalar(
    config,
    `select coalesce(json_agg(json_build_object('schema', schemaname, 'table', tablename)
        order by schemaname, tablename), '[]'::json)::text
     from pg_tables
     where schemaname in ('public', 'storage', 'auth')
       and tablename not like 'pg_%'`
  );
  let list = [];
  try {
    list = JSON.parse(raw || '[]');
  } catch {
    list = [];
  }
  list = list.filter((t) => t?.table && !SKIP_LOCAL.has(t.table));
  // auth: only users
  list = list.filter((t) => t.schema !== 'auth' || t.table === 'users');

  return list.sort((a, b) => {
    const ka = `${a.schema}.${a.table}`;
    const kb = `${b.schema}.${b.table}`;
    const ia = PRIORITY.indexOf(ka);
    const ib = PRIORITY.indexOf(kb);
    if (ia === -1 && ib === -1) return ka.localeCompare(kb);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function fetchRemoteTable(config, schema, table) {
  // Alias MUST NOT be "rows" — conflicts with supabase CLI envelope.rows
  const sql = `select coalesce(json_agg(t), '[]'::json) as data
    from (
      select * from ${quoteIdent(schema)}.${quoteIdent(table)}
      order by 1
      limit 5000
    ) t;`;
  const out = remoteQuery(config, sql);
  const envelope = extractCliRows(out);
  const first = envelope[0] || {};
  if (Array.isArray(first.data)) return first.data;
  if (typeof first.data === 'string') {
    try {
      const parsed = JSON.parse(first.data);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return [];
}

function isCorruptPayload(payload) {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  // Legacy outbox rows corrupted by Windows console encoding (Arabic → ???)
  return /\?{3,}/.test(s) || /\uFFFD/.test(s);
}

function processOutbox(config, colCache = new Map()) {
  const raw = localPsqlScalar(
    config,
    `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (
       select id, table_schema, table_name, op, payload, attempts
       from dr.sync_outbox
       where processed_at is null and next_attempt_at <= now()
       order by id limit 100
     ) t`
  );
  const rows = JSON.parse(raw || '[]');
  let done = 0;
  for (const item of rows) {
    try {
      if (isCorruptPayload(item.payload)) {
        // Do not delete — mark superseded so live sync owns the row
        localPsql(
          config,
          `update dr.sync_outbox
           set processed_at = now(),
               last_error = 'skipped_corrupt_legacy_payload_superseded_by_live_sync'
           where id = ${item.id}`
        );
        appendSyncLog(config, 'warn', 'outbox_skipped_corrupt', { id: item.id, table: item.table_name });
        done += 1;
        continue;
      }
      upsertRow(config, item.table_schema || 'public', item.table_name, item.payload, colCache);
      localPsql(config, `update dr.sync_outbox set processed_at = now(), last_error = null where id = ${item.id}`);
      done += 1;
    } catch (err) {
      const attempts = Number(item.attempts || 0) + 1;
      const delaySec = Math.min(3600, 2 ** Math.min(attempts, 10));
      localPsql(
        config,
        `update dr.sync_outbox set attempts = ${attempts},
           next_attempt_at = now() + make_interval(secs => ${delaySec}),
           last_error = ${sqlLiteral(String(err.message || err))}
         where id = ${item.id}`
      );
      appendSyncLog(config, 'error', 'outbox_retry', { id: item.id, attempts, error: String(err.message || err) });
    }
  }
  return done;
}

async function tick(config) {
  const started = Date.now();
  let total = 0;
  const tables = listLocalMirrorTables(config);
  const colCache = new Map();
  let tableErrors = 0;

  if (!tables.length) {
    appendSyncLog(config, 'error', 'no_local_tables', {});
  }

  for (const t of tables) {
    const schema = t.schema;
    const table = t.table;
    try {
      const rows = fetchRemoteTable(config, schema, table);
      let synced = 0;
      for (const row of rows) {
        try {
          upsertRow(config, schema, table, row, colCache);
          synced += 1;
        } catch (err) {
          localPsql(
            config,
            `insert into dr.sync_outbox(table_schema, table_name, record_pk, op, payload, attempts, next_attempt_at, last_error)
             values ('${schema}', '${table}', ${sqlLiteral(String(row.id ?? JSON.stringify(row)))}, 'UPDATE',
               ${sqlLiteral(row)}, 1, now() + interval '30 seconds', ${sqlLiteral(String(err.message || err))});`
          );
          appendSyncLog(config, 'error', 'upsert_failed', { schema, table, error: String(err.message || err) });
        }
      }
      updateSyncState(config, schema === 'public' ? table : `${schema}.${table}`, {
        rows_synced: synced,
        status: 'ok',
        last_error: null
      });
      total += synced;
    } catch (err) {
      tableErrors += 1;
      updateSyncState(config, schema === 'public' ? table : `${schema}.${table}`, {
        rows_synced: 0,
        status: 'error',
        last_error: String(err.message || err)
      });
      appendSyncLog(config, 'error', 'table_sync_failed', { schema, table, error: String(err.message || err) });
    }
  }

  const outboxDone = processOutbox(config, colCache);
  const status = {
    ts: new Date().toISOString(),
    durationMs: Date.now() - started,
    rowsSynced: total,
    outboxProcessed: outboxDone,
    tables: tables.length,
    tableErrors,
    health: tableErrors === 0 ? 'ok' : 'degraded'
  };
  fs.writeFileSync(path.join(config.paths.sync, 'last-status.json'), JSON.stringify(status, null, 2));
  appendSyncLog(config, tableErrors ? 'warn' : 'info', 'sync_tick', status);
  console.log(
    `[sync] rows=${total} outbox=${outboxDone} tables=${tables.length} errors=${tableErrors} ${status.durationMs}ms`
  );
  return status;
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);

  try {
    localPsqlScalar(config, 'select 1');
    appendSyncLog(config, 'info', 'local_pg_ok', {});
  } catch (err) {
    appendSyncLog(config, 'error', 'local_pg_down', { error: String(err.message || err) });
    throw err;
  }

  try {
    remoteQuery(config, 'select 1 as ok;');
    appendSyncLog(config, 'info', 'supabase_ok', {});
  } catch (err) {
    appendSyncLog(config, 'error', 'supabase_down', { error: String(err.message || err) });
    throw err;
  }

  const once = process.argv.includes('--once') || !process.argv.includes('--allow-continuous');
  if (once) {
    console.log('[sync] one-shot mirror refresh (low-resource mode)');
    await tick(config);
    console.log('[sync] --once complete');
    return;
  }

  console.log(`[sync] CONTINUOUS mode every ${config.sync.pollIntervalMs}ms (--allow-continuous)`);
  await tick(config);
  setInterval(() => {
    tick(config).catch((err) => {
      console.error('[sync] tick failed', err);
      appendSyncLog(config, 'error', 'tick_failed', { error: String(err.message || err) });
    });
  }, config.sync.pollIntervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
