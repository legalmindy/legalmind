/**
 * One-shot daily backup (LOW RESOURCE — exits immediately when finished).
 *
 * Flow (production is READ-ONLY):
 * 1) Refresh local mirror legalmind_backup via sync-service --once (upserts only)
 * 2) pg_dump local → .dump + .sql
 * 3) Compress SQL (+ dump + integrity) into .zip under D:\LegalMind_Backups\daily
 * 4) Verify dump/SQL integrity
 * 5) Keep latest 90 zip sets (delete older backup FILE sets only — never touch production)
 *
 * Usage:
 *   node disaster-recovery/scripts/daily-backup.mjs
 *   node disaster-recovery/scripts/daily-backup.mjs --skip-mirror
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function hasFlag(name) {
  return process.argv.includes(name);
}

function logLine(config, level, message, detail = {}) {
  ensureDirs(config);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(config.paths.logs, `daily-backup-${day}.log`);
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message} ${JSON.stringify(detail)}\n`;
  fs.appendFileSync(file, line, 'utf8');
  appendSyncLog(config, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', message, detail);
}

function run(cmd, args, env, opts = {}) {
  const res = spawnSync(cmd, args, {
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    cwd: opts.cwd || ROOT
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} => ${(res.stderr || res.stdout || '').slice(0, 1200)}`);
  }
  return res;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function psql(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8', windowsHide: true }
  );
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'psql failed');
  return (res.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^INSERT\b/i.test(l) && !/^UPDATE\b/i.test(l) && !/^DELETE\b/i.test(l))
    [0] || '';
}

function verifyDumpIntegrity(config, dumpPath, sqlPath) {
  const detail = { checks: [] };
  const dumpOk = fs.existsSync(dumpPath) && fs.statSync(dumpPath).size >= 64;
  detail.checks.push({ name: 'dump_size', ok: dumpOk, bytes: dumpOk ? fs.statSync(dumpPath).size : 0 });
  const sqlOk = fs.existsSync(sqlPath) && fs.statSync(sqlPath).size >= 64;
  detail.checks.push({ name: 'sql_size', ok: sqlOk, bytes: sqlOk ? fs.statSync(sqlPath).size : 0 });

  let sqlContentOk = false;
  if (sqlOk) {
    const head = fs.readFileSync(sqlPath, { encoding: 'utf8', flag: 'r' }).slice(0, 8000);
    sqlContentOk = /CREATE\s+TABLE|CREATE\s+FUNCTION|COPY\s+/i.test(head) || fs.statSync(sqlPath).size > 1000;
  }
  detail.checks.push({ name: 'sql_content', ok: sqlContentOk });

  const toc = spawnSync(config.local.pgRestorePath, ['-l', dumpPath], {
    env: localConnEnv(config),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  const tocOk = toc.status === 0 && (toc.stdout || '').split(/\r?\n/).length > 5;
  detail.checks.push({ name: 'pg_restore_list', ok: tocOk, lines: (toc.stdout || '').split(/\r?\n/).length });

  // Local DB still reachable
  try {
    const one = psql(config, 'select 1');
    detail.checks.push({ name: 'local_db_select_1', ok: one === '1' });
  } catch (err) {
    detail.checks.push({ name: 'local_db_select_1', ok: false, error: String(err.message || err) });
  }

  // Rough row sanity
  try {
    const tables = Number(psql(config, `select count(*) from pg_tables where schemaname='public'`));
    detail.checks.push({ name: 'public_table_count', ok: tables > 0, tables });
  } catch (err) {
    detail.checks.push({ name: 'public_table_count', ok: false, error: String(err.message || err) });
  }

  detail.sha256 = {
    dump: dumpOk ? sha256File(dumpPath) : null,
    sql: sqlOk ? sha256File(sqlPath) : null
  };

  return { ok: detail.checks.every((c) => c.ok), detail };
}

function compressZip(files, outPath) {
  const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
  const ps = `Compress-Archive -Path @(${list}) -DestinationPath '${outPath.replace(/'/g, "''")}' -Force`;
  run('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], process.env);
}

function rotateRetention(config, dailyDir) {
  const keep = config.retention.keepVerified;
  const zips = fs
    .readdirSync(dailyDir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dailyDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const removed = [];
  for (const item of zips.slice(keep)) {
    const stamp = item.f.replace(/\.zip$/i, '');
    for (const sib of fs.readdirSync(dailyDir)) {
      if (sib === item.f || sib.startsWith(stamp)) {
        const p = path.join(dailyDir, sib);
        try {
          fs.unlinkSync(p);
          removed.push(sib);
        } catch {
          /* ignore locked */
        }
      }
    }
  }
  return removed;
}

function writeLastSuccess(config, payload) {
  const p = path.join(config.paths.logs, 'last-success.json');
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
}

function refreshMirror(config) {
  const syncScript = path.join(__dirname, 'sync-service.mjs');
  logLine(config, 'info', 'mirror_refresh_start', {});
  const res = spawnSync(process.execPath, [syncScript, '--once'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, SUPABASE_INTERNAL_NO_TELEMETRY: '1' }
  });
  if (res.status !== 0) {
    throw new Error(`mirror refresh failed: ${(res.stderr || res.stdout || '').slice(0, 1500)}`);
  }
  logLine(config, 'info', 'mirror_refresh_ok', { tail: (res.stdout || '').slice(-400) });
  return res;
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);
  const dailyDir = path.join(config.paths.root, 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.mkdirSync(config.paths.logs, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(dailyDir, `legalmind_backup_${stamp}`);
  const dumpPath = `${base}.dump`;
  const sqlPath = `${base}.sql`;
  const zipPath = `${base}.zip`;
  const metaPath = `${base}.integrity.json`;

  logLine(config, 'info', 'daily_backup_start', { stamp, database: config.local.database });

  let runId = null;
  try {
    runId = psql(
      config,
      `insert into dr.backup_runs(status, dump_path, sql_path, archive_path)
       values ('running', '${dumpPath.replace(/'/g, "''")}', '${sqlPath.replace(/'/g, "''")}', '${zipPath.replace(/'/g, "''")}')
       returning id`
    );
  } catch {
    /* dr schema may be missing on fresh installs — continue file backups */
  }

  try {
    // 1) Refresh local legalmind_backup from production (READ production only)
    if (!hasFlag('--skip-mirror')) {
      refreshMirror(config);
    } else {
      logLine(config, 'warn', 'mirror_refresh_skipped', {});
    }

    // 2) Dump local mirror
    const env = localConnEnv(config);
    run(
      config.local.pgDumpPath,
      [
        '-h', config.local.host, '-p', String(config.local.port),
        '-U', config.local.user, '-d', config.local.database,
        '-Fc', '-f', dumpPath
      ],
      env
    );
    run(
      config.local.pgDumpPath,
      [
        '-h', config.local.host, '-p', String(config.local.port),
        '-U', config.local.user, '-d', config.local.database,
        '--format=plain', '--no-owner', '--no-acl', '-f', sqlPath
      ],
      env
    );

    // 3) Verify
    const integrity = verifyDumpIntegrity(config, dumpPath, sqlPath);
    fs.writeFileSync(metaPath, JSON.stringify({ ...integrity, createdAt: new Date().toISOString() }, null, 2));

    // 4) Compressed SQL package (sql + dump + integrity)
    compressZip([dumpPath, sqlPath, metaPath], zipPath);
    const size = fs.statSync(zipPath).size;

    // 5) Retention 90
    const removed = rotateRetention(config, dailyDir);

    if (runId) {
      try {
        psql(
          config,
          `update dr.backup_runs set finished_at=now(), status='${integrity.ok ? 'ok' : 'integrity_failed'}',
             size_bytes=${size}, integrity_ok=${integrity.ok ? 'true' : 'false'},
             integrity_detail=${`'${JSON.stringify(integrity.detail).replace(/'/g, "''")}'`}::jsonb
           where id='${runId}'`
        );
      } catch {
        /* ignore */
      }
    }

    const result = {
      ok: integrity.ok,
      stamp,
      dumpPath,
      sqlPath,
      zipPath,
      size,
      removedCount: removed.length,
      integrity
    };

    if (integrity.ok) {
      writeLastSuccess(config, {
        at: new Date().toISOString(),
        zipPath,
        dumpPath,
        sqlPath,
        size,
        sha256: integrity.detail.sha256
      });
    }

    logLine(config, integrity.ok ? 'info' : 'error', 'daily_backup_finished', result);
    console.log(JSON.stringify(result, null, 2));
    if (!integrity.ok) process.exit(2);
  } catch (err) {
    if (runId) {
      try {
        psql(
          config,
          `update dr.backup_runs set finished_at=now(), status='error', error=${`'${String(err.message || err).replace(/'/g, "''")}'`}
           where id='${runId}'`
        );
      } catch {
        /* ignore */
      }
    }
    logLine(config, 'error', 'daily_backup_failed', { error: String(err.message || err) });
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
