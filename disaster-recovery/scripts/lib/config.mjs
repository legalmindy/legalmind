import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadDrConfig() {
  const envPath = path.join(ROOT, '.env.disaster-recovery');
  const env = {
    ...parseEnvFile(path.join(ROOT, '.env.local')),
    ...parseEnvFile(envPath),
    ...process.env
  };

  const config = {
    supabase: {
      url: env.SUPABASE_URL || env.VITE_SUPABASE_URL || '',
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
      anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''
    },
    local: {
      host: env.LOCAL_PG_HOST || '127.0.0.1',
      port: Number(env.LOCAL_PG_PORT || 5432),
      database: env.LOCAL_PG_DATABASE || 'legalmind_backup',
      user: env.LOCAL_PG_USER || 'legalmind_backup',
      password: env.LOCAL_PG_PASSWORD || 'LegalMind_Backup_Local_2026!',
      psqlPath: env.LOCAL_PSQL_PATH || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
      pgDumpPath: env.LOCAL_PG_DUMP_PATH || 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
      pgRestorePath: env.LOCAL_PG_RESTORE_PATH || 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe'
    },
    paths: {
      root: env.BACKUP_ROOT || 'D:\\LegalMind_Backups',
      nightly: path.join(env.BACKUP_ROOT || 'D:\\LegalMind_Backups', 'nightly'),
      logs: path.join(env.BACKUP_ROOT || 'D:\\LegalMind_Backups', 'logs'),
      sync: path.join(env.BACKUP_ROOT || 'D:\\LegalMind_Backups', 'sync'),
      archive: path.join(env.BACKUP_ROOT || 'D:\\LegalMind_Backups', 'archive'),
      storage: path.join(env.BACKUP_ROOT || 'D:\\LegalMind_Backups', 'storage')
    },
    sync: {
      pollIntervalMs: Number(env.SYNC_POLL_INTERVAL_MS || 15000),
      batchSize: Number(env.SYNC_BATCH_SIZE || 500),
      maxRetries: Number(env.SYNC_MAX_RETRIES || 12)
    },
    retention: {
      keepVerified: Number(env.BACKUP_KEEP_VERIFIED || 90)
      // Never delete automatically — older backups are moved to archive/ only when explicitly requested.
    }
  };

  if (!config.supabase.url) {
    console.warn('[DR] SUPABASE_URL missing — sync will be disabled until configured.');
  }
  if (!config.supabase.serviceRoleKey && process.env.DR_REQUIRE_SERVICE_ROLE === '1') {
    console.warn('[DR] SUPABASE_SERVICE_ROLE_KEY missing — sync requires service role.');
  }

  return config;
}

export function ensureDirs(config) {
  for (const p of Object.values(config.paths)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

export function appendSyncLog(config, level, event, detail = {}) {
  ensureDirs(config);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    detail
  });
  fs.appendFileSync(path.join(config.paths.logs, 'sync.jsonl'), line + '\n', 'utf8');
}

export function localConnEnv(config) {
  return { ...process.env, PGPASSWORD: config.local.password };
}
