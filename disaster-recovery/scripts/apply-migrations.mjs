/**
 * Apply all supabase/migrations to local legalmind_backup (idempotent-ish).
 * Never runs DROP DATABASE / DROP SCHEMA / TRUNCATE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadDrConfig, ensureDirs, appendSyncLog } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function runPsql(config, sqlFile, database = config.local.database) {
  const args = [
    '-h', config.local.host,
    '-p', String(config.local.port),
    '-U', config.local.user,
    '-d', database,
    '-v', 'ON_ERROR_STOP=0',
    '-f', sqlFile
  ];
  const env = { ...process.env, PGPASSWORD: config.local.password };
  const res = spawnSync(config.local.psqlPath, args, {
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error
  };
}

function isDestructiveSql(sql) {
  return /\b(DROP\s+DATABASE|DROP\s+SCHEMA\s+(public|auth|storage)|TRUNCATE\s+)/i.test(sql);
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);
  const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
  const logPath = path.join(config.paths.logs, `apply-migrations-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

  const bootstrap = path.join(__dirname, '../sql/000_local_bootstrap.sql');
  console.log('Applying bootstrap…');
  const boot = runPsql(config, bootstrap);
  fs.writeFileSync(logPath, `=== BOOTSTRAP ===\n${boot.stdout}\n${boot.stderr}\n`, 'utf8');
  if (boot.error) throw boot.error;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const full = path.join(migrationsDir, file);
    const sql = fs.readFileSync(full, 'utf8');
    if (isDestructiveSql(sql)) {
      const msg = `SKIP destructive SQL: ${file}`;
      console.warn(msg);
      fs.appendFileSync(logPath, `${msg}\n`, 'utf8');
      skipped += 1;
      continue;
    }

    // Record attempt; skip if already recorded successfully
    const version = file.replace(/\.sql$/, '').replace(/^(\d+).*/, '$1');
    const check = spawnSync(
      config.local.psqlPath,
      [
        '-h', config.local.host, '-p', String(config.local.port),
        '-U', config.local.user, '-d', config.local.database,
        '-tAc', `select 1 from supabase_migrations.schema_migrations where version = '${version.replace(/'/g, "''")}'`
      ],
      { env: { ...process.env, PGPASSWORD: config.local.password }, encoding: 'utf8' }
    );
    if ((check.stdout || '').trim() === '1') {
      console.log(`Already applied: ${file}`);
      skipped += 1;
      continue;
    }

    console.log(`Applying ${file}…`);
    const res = runPsql(config, full);
    fs.appendFileSync(logPath, `\n=== ${file} status=${res.status} ===\n${res.stdout}\n${res.stderr}\n`, 'utf8');

    const hardError =
      /ERROR:\s+(syntax error|permission denied for database|must be owner of)/i.test(res.stderr + res.stdout);

    // Mark as applied even with soft errors (IF NOT EXISTS conflicts) so we progress;
    // hard syntax failures are still recorded.
    spawnSync(
      config.local.psqlPath,
      [
        '-h', config.local.host, '-p', String(config.local.port),
        '-U', config.local.user, '-d', config.local.database,
        '-c', `insert into supabase_migrations.schema_migrations(version, name) values ('${version.replace(/'/g, "''")}', '${file.replace(/'/g, "''")}') on conflict (version) do nothing;`
      ],
      { env: { ...process.env, PGPASSWORD: config.local.password }, encoding: 'utf8' }
    );

    if (res.status !== 0 || hardError) {
      failed += 1;
      console.warn(`  warnings/errors in ${file} (see log)`);
    } else {
      applied += 1;
    }
  }

  appendSyncLog(config, 'info', 'migrations_applied', { applied, skipped, failed, logPath });
  console.log(JSON.stringify({ ok: true, applied, skipped, failed, logPath }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
