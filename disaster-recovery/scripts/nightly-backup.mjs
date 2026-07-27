/**
 * Nightly local backup: custom dump + plain SQL + compressed archive + integrity check.
 * Retention: keep latest 90 as "active"; older files are MOVED to archive/ (never deleted).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(cmd, args, env) {
  const res = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`${cmd} failed: ${res.stderr || res.stdout}`);
  }
  return res;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function psql(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
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
  if (!fs.existsSync(dumpPath) || fs.statSync(dumpPath).size < 64) {
    detail.checks.push({ name: 'dump_size', ok: false });
    return { ok: false, detail };
  }
  detail.checks.push({ name: 'dump_size', ok: true, bytes: fs.statSync(dumpPath).size });

  if (!fs.existsSync(sqlPath) || fs.statSync(sqlPath).size < 64) {
    detail.checks.push({ name: 'sql_size', ok: false });
    return { ok: false, detail };
  }
  detail.checks.push({ name: 'sql_size', ok: true, bytes: fs.statSync(sqlPath).size });

  const sqlHead = fs.readFileSync(sqlPath, { encoding: 'utf8', flag: 'r' }).slice(0, 4000);
  const hasCreate = /CREATE\s+TABLE|CREATE\s+FUNCTION|COPY\s+/i.test(sqlHead) || fs.statSync(sqlPath).size > 1000;
  detail.checks.push({ name: 'sql_content', ok: hasCreate });

  // List TOC from custom dump
  const toc = spawnSync(config.local.pgRestorePath, ['-l', dumpPath], {
    env: localConnEnv(config),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  const tocOk = toc.status === 0 && (toc.stdout || '').split(/\r?\n/).length > 5;
  detail.checks.push({ name: 'pg_restore_list', ok: tocOk, lines: (toc.stdout || '').split(/\r?\n/).length });

  detail.sha256 = {
    dump: sha256File(dumpPath),
    sql: sha256File(sqlPath)
  };

  return { ok: detail.checks.every((c) => c.ok), detail };
}

function compressZip(files, outPath) {
  // Prefer PowerShell Compress-Archive (available on Windows)
  const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
  const ps = `Compress-Archive -Path @(${list}) -DestinationPath '${outPath.replace(/'/g, "''")}' -Force`;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'zip failed');
}

function rotateRetention(config) {
  const keep = config.retention.keepVerified;
  const dir = config.paths.nightly;
  const archives = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  // NEVER delete — move excess to archive/
  for (const item of archives.slice(keep)) {
    const src = path.join(dir, item.f);
    const dest = path.join(config.paths.archive, item.f);
    fs.renameSync(src, dest);
    // Move sibling files with same stamp prefix
    const stamp = item.f.replace(/\.zip$/, '');
    for (const sib of fs.readdirSync(dir)) {
      if (sib.startsWith(stamp) && sib !== item.f) {
        fs.renameSync(path.join(dir, sib), path.join(config.paths.archive, sib));
      }
    }
    appendSyncLog(config, 'info', 'backup_archived_not_deleted', { file: item.f, dest });
  }
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(config.paths.nightly, `legalmind_backup_${stamp}`);
  const dumpPath = `${base}.dump`;
  const sqlPath = `${base}.sql`;
  const zipPath = `${base}.zip`;
  const metaPath = `${base}.integrity.json`;

  const runId = psql(
    config,
    `insert into dr.backup_runs(status, dump_path, sql_path, archive_path)
     values ('running', '${dumpPath.replace(/'/g, "''")}', '${sqlPath.replace(/'/g, "''")}', '${zipPath.replace(/'/g, "''")}')
     returning id`
  );

  try {
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

    const integrity = verifyDumpIntegrity(config, dumpPath, sqlPath);
    fs.writeFileSync(metaPath, JSON.stringify(integrity, null, 2));
    compressZip([dumpPath, sqlPath, metaPath], zipPath);

    const size = fs.statSync(zipPath).size;
    psql(
      config,
      `update dr.backup_runs set finished_at=now(), status='${integrity.ok ? 'ok' : 'integrity_failed'}',
         size_bytes=${size}, integrity_ok=${integrity.ok ? 'true' : 'false'},
         integrity_detail=${`'${JSON.stringify(integrity.detail).replace(/'/g, "''")}'`}::jsonb
       where id='${runId}'`
    );

    rotateRetention(config);

    // Storage binary backup (local only — never mutates production)
    let storageResult = null;
    const storageScript = path.join(__dirname, 'storage-backup.mjs');
    if (fs.existsSync(storageScript)) {
      const st = spawnSync(process.execPath, [storageScript], {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      });
      storageResult = {
        status: st.status,
        stdoutTail: (st.stdout || '').slice(-500),
        stderrTail: (st.stderr || '').slice(-300)
      };
      if (st.status !== 0) {
        appendSyncLog(config, 'warn', 'storage_backup_nightly_warn', storageResult);
      } else {
        appendSyncLog(config, 'info', 'storage_backup_nightly_ok', storageResult);
      }
    }

    appendSyncLog(config, integrity.ok ? 'info' : 'error', 'nightly_backup', {
      dumpPath, sqlPath, zipPath, size, integrity, storageResult
    });
    console.log(JSON.stringify({ ok: integrity.ok, dumpPath, sqlPath, zipPath, size, runId, storageResult }, null, 2));
    if (!integrity.ok) process.exit(2);
  } catch (err) {
    try {
      psql(
        config,
        `update dr.backup_runs set finished_at=now(), status='error', error=${`'${String(err.message || err).replace(/'/g, "''")}'`}
         where id='${runId}'`
      );
    } catch {
      /* ignore */
    }
    appendSyncLog(config, 'error', 'nightly_backup_failed', { error: String(err.message || err) });
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
