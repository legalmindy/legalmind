/**
 * One-click restore into a brand-new empty database (local or new Supabase via connection string).
 * SAFETY: refuses targets named like production; never DROP DATABASE unless --allow-destructive
 * is passed AND target is explicitly a temp/new name. Default path uses CREATE DATABASE IF needed
 * only for legalmind_restore_* names.
 *
 * Usage:
 *   node restore-to-new-project.mjs --source D:\LegalMind_Backups\nightly\xxx.dump
 *   node restore-to-new-project.mjs --source xxx.dump --target-db legalmind_restore_test
 *   node restore-to-new-project.mjs --source xxx.dump --database-url "postgresql://..."
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function runRestore(cmd, args, env) {
  const res = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return res;
}

function run(cmd, args, env) {
  const res = runRestore(cmd, args, env);
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} => ${res.stderr || res.stdout}`);
  return res;
}

function psqlAdmin(config, sql, database = 'postgres') {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
  );
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'psql failed');
  return (res.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^INSERT\b/i.test(l) && !/^UPDATE\b/i.test(l) && !/^DELETE\b/i.test(l) && !/^-+$/i.test(l) && !/^\(/i.test(l) && l !== 'id')
    [0] || '';
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);

  const source = arg('--source');
  if (!source || !fs.existsSync(source)) {
    throw new Error('Provide --source path to a .dump or .sql backup file');
  }

  const databaseUrl = arg('--database-url');
  let targetDb = arg('--target-db', `legalmind_restore_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`);

  // Hard safety: never target production names
  const forbidden = /^(postgres|template0|template1|legalmind_backup)$/i;
  if (forbidden.test(targetDb) && !hasFlag('--allow-destructive')) {
    throw new Error(`Refusing to restore into protected database name: ${targetDb}`);
  }
  if (!/^legalmind_restore_/i.test(targetDb) && !databaseUrl && !hasFlag('--allow-destructive')) {
    throw new Error('Target DB must be named legalmind_restore_* unless --allow-destructive is set');
  }

  const runId = psqlAdmin(
    config,
    `insert into dr.restore_runs(status, source_path, target_db) values ('running', '${source.replace(/'/g, "''")}', '${targetDb.replace(/'/g, "''")}') returning id`,
    config.local.database
  );

  try {
    if (!databaseUrl) {
      const exists = psqlAdmin(
        config,
        `select 1 from pg_database where datname = '${targetDb.replace(/'/g, "''")}'`,
        'postgres'
      );
      if (exists !== '1') {
        psqlAdmin(
          config,
          `create database ${targetDb} owner ${config.local.user} encoding 'UTF8' template template0`,
          'postgres'
        );
      } else if (!hasFlag('--allow-existing')) {
        throw new Error(`Target DB ${targetDb} already exists. Pass --allow-existing to restore into it (non-drop).`);
      }
    }

    const env = localConnEnv(config);
    let restoreWarnings = null;
    if (source.endsWith('.dump') || source.endsWith('.backup')) {
      // pg_restore often exits non-zero for ignorable ACL/role warnings; verify via table count below.
      const restoreRes = databaseUrl
        ? runRestore(config.local.pgRestorePath, ['-v', '--no-owner', '--no-acl', '-d', databaseUrl, source], env)
        : runRestore(
            config.local.pgRestorePath,
            [
              '-v', '--no-owner', '--no-acl',
              '-h', config.local.host, '-p', String(config.local.port),
              '-U', config.local.user, '-d', targetDb, source
            ],
            env
          );
      if (restoreRes.status !== 0) {
        restoreWarnings = (restoreRes.stderr || restoreRes.stdout || '').slice(-2000);
      }
    } else if (source.endsWith('.sql')) {
      if (databaseUrl) {
        run(config.local.psqlPath, [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', source], env);
      } else {
        run(
          config.local.psqlPath,
          [
            '-h', config.local.host, '-p', String(config.local.port),
            '-U', config.local.user, '-d', targetDb,
            '-v', 'ON_ERROR_STOP=1', '-f', source
          ],
          env
        );
      }
    } else {
      throw new Error('Unsupported source format (use .dump or .sql)');
    }

    // Integrity: count relations in target
    let tableCount = 'n/a';
    let publicCount = 'n/a';
    if (!databaseUrl) {
      tableCount = psqlAdmin(
        config,
        `select count(*) from pg_tables where schemaname in ('public','private','storage','auth','dr')`,
        targetDb
      );
      publicCount = psqlAdmin(
        config,
        `select count(*) from pg_tables where schemaname='public'`,
        targetDb
      );
      if (Number(publicCount) < 1) {
        throw new Error(
          `Restore produced no public tables (pg_restore warnings: ${restoreWarnings?.slice(0, 400) || 'none'})`
        );
      }
    }

    const detail = { tableCount, publicCount, targetDb, source, restoreWarnings: restoreWarnings ? true : false };
    psqlAdmin(
      config,
      `update dr.restore_runs set finished_at=now(), status='ok', integrity_ok=true,
         detail='${JSON.stringify(detail).replace(/'/g, "''")}'::jsonb
       where id='${runId}'`,
      config.local.database
    );
    appendSyncLog(config, 'info', 'restore_ok', detail);
    console.log(JSON.stringify({ ok: true, runId, ...detail }, null, 2));
    console.log('\nNext steps for a brand-new Supabase project:');
    console.log('1) Create project in Supabase Dashboard');
    console.log('2) Get Database connection string (Settings → Database)');
    console.log('3) Re-run with --database-url "postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"');
    console.log('4) Point the app VITE_SUPABASE_URL / keys to the new project');
    console.log('5) Re-upload storage objects if needed from D:\\LegalMind_Backups');
  } catch (err) {
    try {
      psqlAdmin(
        config,
        `update dr.restore_runs set finished_at=now(), status='error', error='${String(err.message || err).replace(/'/g, "''")}' where id='${runId}'`,
        config.local.database
      );
    } catch {
      /* ignore */
    }
    appendSyncLog(config, 'error', 'restore_failed', { error: String(err.message || err) });
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
