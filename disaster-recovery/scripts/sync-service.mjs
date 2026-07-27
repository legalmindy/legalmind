/**
 * Pull all public (+ storage metadata) rows from linked Supabase via SQL,
 * upsert into local legalmind_backup. Retries via dr.sync_outbox.
 * Usage: node sync-service.mjs [--once]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

function localPsql(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    [
      '-h', config.local.host, '-p', String(config.local.port),
      '-U', config.local.user, '-d', config.local.database,
      '-v', 'ON_ERROR_STOP=1', '-tAc', sql
    ],
    { env: localConnEnv(config), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'local psql failed');
  return (res.stdout || '').trim();
}

function remoteQuery(sqlFile) {
  const res = spawnSync(
    'npx',
    ['supabase', 'db', 'query', '--linked', '-f', sqlFile],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
    }
  );
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'remote query failed');
  return res.stdout || '';
}

function extractJsonRows(cliOutput) {
  // supabase db query prints a JSON envelope with rows
  const start = cliOutput.indexOf('{');
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(cliOutput.slice(start));
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  // Sometimes multiple JSON docs — take last object with rows
  const matches = [...cliOutput.matchAll(/\{"boundary":[\s\S]*?"rows":(\[[\s\S]*?\])/g)];
  if (matches.length) {
    try {
      return JSON.parse(matches[matches.length - 1][1]);
    } catch {
      return [];
    }
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
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function localColumns(config, schema, table) {
  const raw = localPsql(
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

function listRemoteTables() {
  const tmp = path.join(process.env.TEMP || '/tmp', `lm-tables-${Date.now()}.sql`);
  fs.writeFileSync(
    tmp,
    `select json_agg(json_build_object('schema', schemaname, 'table', tablename) order by schemaname, tablename) as tables
     from pg_tables
     where (
         schemaname in ('public','storage','auth')
         and tablename not in ('schema_migrations','schema_migrations_history')
         and tablename not like 'pg_%'
       )
       and not (schemaname = 'auth' and tablename not in ('users'));`
  );
  try {
    const out = remoteQuery(tmp);
    const rows = extractJsonRows(out);
    const first = rows[0];
    const list = first?.tables || [];
    const priority = [
      'auth.users',
      'public.firms',
      'public.firm_roles',
      'public.firm_codes',
      'public.employees',
      'public.profiles',
      'public.lawyers',
      'public.clients',
      'public.cases',
      'storage.buckets',
      'storage.objects'
    ];
    return list.sort((a, b) => {
      const ka = `${a.schema}.${a.table}`;
      const kb = `${b.schema}.${b.table}`;
      const ia = priority.indexOf(ka);
      const ib = priority.indexOf(kb);
      if (ia === -1 && ib === -1) return ka.localeCompare(kb);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  } finally {
    fs.unlinkSync(tmp);
  }
}

function fetchRemoteTable(schema, table) {
  const tmp = path.join(process.env.TEMP || '/tmp', `lm-sync-${schema}-${table}-${Date.now()}.sql`);
  // Cap initial sync pages via limit for very large tables; full sync uses updated_at watermark next.
  fs.writeFileSync(
    tmp,
    `select coalesce(json_agg(t), '[]'::json) as rows
     from (
       select * from ${quoteIdent(schema)}.${quoteIdent(table)}
       order by 1
       limit 5000
     ) t;`
  );
  try {
    const out = remoteQuery(tmp);
    const envelope = extractJsonRows(out);
    const payload = envelope[0]?.rows;
    if (Array.isArray(payload)) return payload;
    return [];
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function processOutbox(config, colCache = new Map()) {
  const raw = localPsql(
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
  const tables = listRemoteTables();
  const colCache = new Map();

  for (const t of tables) {
    const schema = t.schema || t.schemaname || 'public';
    const table = t.table || t.tablename;
    if (!table) continue;
    const exists = localPsql(
      config,
      `select to_regclass('${schema.replace(/'/g, "''")}.${table.replace(/'/g, "''")}') is not null`
    );
    if (exists !== 't' && exists !== 'true') {
      appendSyncLog(config, 'warn', 'local_table_missing', { schema, table });
      continue;
    }
    try {
      const rows = fetchRemoteTable(schema, table);
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
    tables: tables.length
  };
  fs.writeFileSync(path.join(config.paths.sync, 'last-status.json'), JSON.stringify(status, null, 2));
  appendSyncLog(config, 'info', 'sync_tick', status);
  console.log(`[sync] rows=${total} outbox=${outboxDone} tables=${tables.length} ${status.durationMs}ms`);
  return status;
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);

  try {
    localPsql(config, 'select 1');
    appendSyncLog(config, 'info', 'local_pg_ok', {});
  } catch (err) {
    appendSyncLog(config, 'error', 'local_pg_down', { error: String(err.message || err) });
    throw err;
  }

  // Probe remote
  const tmp = path.join(process.env.TEMP || '/tmp', `lm-ping-${Date.now()}.sql`);
  fs.writeFileSync(tmp, 'select 1 as ok;');
  try {
    remoteQuery(tmp);
    appendSyncLog(config, 'info', 'supabase_ok', {});
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }

  console.log(`[sync] SQL-linked sync every ${config.sync.pollIntervalMs}ms`);
  await tick(config);
  if (process.argv.includes('--once')) {
    console.log('[sync] --once complete');
    return;
  }
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
