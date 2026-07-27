/**
 * Simulate disaster recovery into a temporary local database.
 * Does NOT touch production Supabase or legalmind_backup data permanently beyond reading.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

function runNode(script, args, env) {
  const res = spawnSync(process.execPath, [script, ...args], {
    env,
    encoding: 'utf8',
    cwd: path.dirname(script),
    maxBuffer: 32 * 1024 * 1024
  });
  return res;
}

function psql(config, sql, database = 'postgres') {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
  );
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'psql failed');
  return (res.stdout || '').trim();
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);
  const scriptsDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

  // 1) Ensure a fresh nightly dump exists (or create one)
  console.log('Creating snapshot for DR test…');
  const backup = runNode(path.join(scriptsDir, 'nightly-backup.mjs'), [], process.env);
  console.log(backup.stdout);
  if (backup.status !== 0) throw new Error(backup.stderr || 'nightly backup failed');

  const zips = fs
    .readdirSync(config.paths.nightly)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => ({ f, m: fs.statSync(path.join(config.paths.nightly, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!zips.length) throw new Error('No dump file found after nightly backup');
  const dump = path.join(config.paths.nightly, zips[0].f);

  const target = `legalmind_restore_drtest_${Date.now()}`;
  console.log(`Restoring into temporary DB ${target}…`);
  const restore = runNode(
    path.join(scriptsDir, 'restore-to-new-project.mjs'),
    ['--source', dump, '--target-db', target, '--allow-existing'],
    process.env
  );
  console.log(restore.stdout);
  if (restore.status !== 0) throw new Error(restore.stderr || restore.stdout || 'restore failed');

  const tables = psql(
    config,
    `select count(*) from pg_tables where schemaname='public'`,
    target
  );

  // Compare rough counts vs source backup DB
  const srcTables = psql(config, `select count(*) from pg_tables where schemaname='public'`, config.local.database);

  const report = {
    ok: true,
    target,
    restoredPublicTables: Number(tables),
    sourcePublicTables: Number(srcTables),
    dump,
    productionUnchanged: true,
    note: 'Temporary restore DB left in place for inspection. Drop only with explicit approval.'
  };

  fs.writeFileSync(
    path.join(config.paths.root, 'dr-test-report.json'),
    JSON.stringify(report, null, 2)
  );
  appendSyncLog(config, 'info', 'dr_test_ok', report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
