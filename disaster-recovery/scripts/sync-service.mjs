/**
 * Supabase → local PostgreSQL continuous sync.
 * Polls all public tables (and storage.objects metadata) by updated_at/created_at.
 * Failed upserts go to dr.sync_outbox with exponential backoff retries.
 * Never issues DROP/TRUNCATE.
 */
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const RESERVED = new Set(['schema_migrations']);

function psql(config, sql) {
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
    { env: localConnEnv(config), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  if (res.status !== 0) {
    const err = new Error(res.stderr || res.stdout || 'psql failed');
    err.stderr = res.stderr;
    throw err;
  }
  return (res.stdout || '').trim();
}

function listLocalPublicTables(config) {
  const raw = psql(
    config,
    `select json_agg(quote_ident(tablename)) from pg_tables where schemaname='public' and tablename not like 'pg_%'`
  );
  if (!raw || raw === '') return [];
  try {
    return JSON.parse(raw).map((t) => t.replace(/^"|"$/g, ''));
  } catch {
    return [];
  }
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

function detectPk(row) {
  if (row && row.id != null) return String(row.id);
  return JSON.stringify(row);
}

function upsertRow(config, table, row) {
  const cols = Object.keys(row);
  if (!cols.length) return;
  const colList = cols.map(quoteIdent).join(', ');
  const values = cols.map((c) => sqlLiteral(row[c])).join(', ');
  const updates = cols
    .filter((c) => c !== 'id')
    .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
    .join(', ');

  const conflict = cols.includes('id') ? 'id' : cols[0];
  const sql = updates
    ? `insert into public.${quoteIdent(table)} (${colList}) values (${values}) on conflict (${quoteIdent(conflict)}) do update set ${updates};`
    : `insert into public.${quoteIdent(table)} (${colList}) values (${values}) on conflict do nothing;`;

  psql(config, sql);
}

function enqueueOutbox(config, table, op, row, error) {
  const pk = detectPk(row);
  const payload = sqlLiteral(row);
  const err = sqlLiteral(String(error?.message || error || 'unknown'));
  psql(
    config,
    `insert into dr.sync_outbox(table_name, record_pk, op, payload, attempts, next_attempt_at, last_error)
     values ('${table.replace(/'/g, "''")}', '${pk.replace(/'/g, "''")}', '${op}', ${payload}, 1, now() + interval '30 seconds', ${err});`
  );
}

function updateSyncState(config, table, patch) {
  const rows = Number(patch.rows_synced || 0);
  const status = String(patch.status || 'ok').replace(/'/g, "''");
  const err = patch.last_error != null ? sqlLiteral(String(patch.last_error)) : 'NULL';
  const cursor = patch.last_cursor != null ? sqlLiteral(String(patch.last_cursor)) : 'NULL';
  psql(
    config,
    `insert into dr.sync_state(table_name, last_synced_at, rows_synced, status, last_error, last_cursor, updated_at)
     values ('${table.replace(/'/g, "''")}', now(), ${rows}, '${status}', ${err}, ${cursor}, now())
     on conflict (table_schema, table_name) do update set
       last_synced_at = now(),
       rows_synced = dr.sync_state.rows_synced + excluded.rows_synced,
       status = excluded.status,
       last_error = excluded.last_error,
       last_cursor = coalesce(excluded.last_cursor, dr.sync_state.last_cursor),
       updated_at = now();`
  );
}

async function fetchTablePage(supabase, table, sinceIso, from, to) {
  // Prefer updated_at watermark; fall back to created_at; else full page scan.
  let q = supabase.from(table).select('*').range(from, to);
  if (sinceIso) {
    q = q.or(`updated_at.gt.${sinceIso},created_at.gt.${sinceIso}`);
  }
  const { data, error } = await q;
  if (error) {
    // Some tables lack timestamps — retry without filter.
    if (/column|does not exist/i.test(error.message)) {
      const retry = await supabase.from(table).select('*').range(from, to);
      return retry;
    }
  }
  return { data, error };
}

async function syncTable(config, supabase, table) {
  const stateRaw = psql(
    config,
    `select coalesce(last_cursor, to_char(coalesce(last_synced_at, '1970-01-01'::timestamptz), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     from dr.sync_state where table_schema='public' and table_name='${table.replace(/'/g, "''")}'`
  );
  const since = stateRaw || '1970-01-01T00:00:00.000Z';
  let synced = 0;
  let offset = 0;
  const batch = config.sync.batchSize;
  let newest = since;

  for (;;) {
    const { data, error } = await fetchTablePage(supabase, table, since, offset, offset + batch - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      try {
        upsertRow(config, table, row);
        synced += 1;
        const stamp = row.updated_at || row.created_at;
        if (stamp && String(stamp) > newest) newest = String(stamp);
      } catch (err) {
        enqueueOutbox(config, table, 'UPDATE', row, err);
        appendSyncLog(config, 'error', 'upsert_failed', { table, pk: detectPk(row), error: String(err.message || err) });
      }
    }

    if (data.length < batch) break;
    offset += batch;
  }

  updateSyncState(config, table, {
    rows_synced: synced,
    status: 'ok',
    last_error: null,
    last_cursor: newest
  });
  return synced;
}

function processOutbox(config) {
  const raw = psql(
    config,
    `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (
       select id, table_name, op, payload, attempts
       from dr.sync_outbox
       where processed_at is null and next_attempt_at <= now()
       order by id
       limit 100
     ) t`
  );
  const rows = JSON.parse(raw || '[]');
  let done = 0;
  for (const item of rows) {
    try {
      if (item.op === 'DELETE') {
        if (item.payload?.id) {
          psql(config, `delete from public.${quoteIdent(item.table_name)} where id = ${sqlLiteral(item.payload.id)}`);
        }
      } else {
        upsertRow(config, item.table_name, item.payload);
      }
      psql(config, `update dr.sync_outbox set processed_at = now(), last_error = null where id = ${item.id}`);
      done += 1;
    } catch (err) {
      const attempts = Number(item.attempts || 0) + 1;
      const delaySec = Math.min(3600, 2 ** Math.min(attempts, 10));
      psql(
        config,
        `update dr.sync_outbox set attempts = ${attempts},
           next_attempt_at = now() + make_interval(secs => ${delaySec}),
           last_error = ${sqlLiteral(String(err.message || err))}
         where id = ${item.id}`
      );
      appendSyncLog(config, 'error', 'outbox_retry', { id: item.id, attempts, error: String(err.message || err) });
      if (attempts > config.sync.maxRetries) {
        appendSyncLog(config, 'error', 'outbox_exhausted', { id: item.id, table: item.table_name });
      }
    }
  }
  return done;
}

async function syncStorageMetadata(config, supabase) {
  const { data, error } = await supabase.schema('storage').from('objects').select('*').limit(config.sync.batchSize);
  if (error) {
    // Fallback: skip if schema API unavailable
    appendSyncLog(config, 'warn', 'storage_sync_skip', { error: error.message });
    return 0;
  }
  let n = 0;
  for (const row of data || []) {
    try {
      const cols = Object.keys(row);
      const colList = cols.map(quoteIdent).join(', ');
      const values = cols.map((c) => sqlLiteral(row[c])).join(', ');
      psql(
        config,
        `insert into storage.objects (${colList}) values (${values})
         on conflict (id) do update set
           name = excluded.name,
           updated_at = excluded.updated_at,
           metadata = excluded.metadata,
           user_metadata = excluded.user_metadata;`
      );
      n += 1;
    } catch (err) {
      appendSyncLog(config, 'error', 'storage_upsert_failed', { error: String(err.message || err) });
    }
  }
  updateSyncState(config, 'storage.objects', { rows_synced: n, status: 'ok' });
  return n;
}

async function tick(config, supabase) {
  const started = Date.now();
  let total = 0;
  const tables = listLocalPublicTables(config).filter((t) => !RESERVED.has(t));

  for (const table of tables) {
    try {
      total += await syncTable(config, supabase, table);
    } catch (err) {
      updateSyncState(config, table, { rows_synced: 0, status: 'error', last_error: String(err.message || err) });
      appendSyncLog(config, 'error', 'table_sync_failed', { table, error: String(err.message || err) });
    }
  }

  try {
    total += await syncStorageMetadata(config, supabase);
  } catch (err) {
    appendSyncLog(config, 'error', 'storage_sync_failed', { error: String(err.message || err) });
  }

  const outboxDone = processOutbox(config);
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

  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.disaster-recovery');
    process.exit(1);
  }

  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Connectivity checks
  try {
    psql(config, 'select 1');
    appendSyncLog(config, 'info', 'local_pg_ok', {});
  } catch (err) {
    appendSyncLog(config, 'error', 'local_pg_down', { error: String(err.message || err) });
    throw err;
  }

  const { error } = await supabase.from('firms').select('id').limit(1);
  if (error) {
    appendSyncLog(config, 'error', 'supabase_down', { error: error.message });
    throw error;
  }
  appendSyncLog(config, 'info', 'supabase_ok', {});

  console.log(`[sync] starting poll every ${config.sync.pollIntervalMs}ms`);
  await tick(config, supabase);
  setInterval(() => {
    tick(config, supabase).catch((err) => {
      console.error('[sync] tick failed', err);
      appendSyncLog(config, 'error', 'tick_failed', { error: String(err.message || err) });
    });
  }, config.sync.pollIntervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
