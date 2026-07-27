/**
 * Backup all Supabase Storage buckets to local disk (READ production, WRITE local only).
 * Inventory: remote SQL when available, else local mirror storage.* metadata.
 * Download: Storage SDK → signed URL → raw HTTP (service_role). Never deletes remote.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function remoteSqlJson(sql) {
  const tmp = path.join(process.env.TEMP || '.', `lm-st-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  const out = path.join(process.env.TEMP || '.', `lm-st-${Date.now()}-${Math.random().toString(16).slice(2)}.out`);
  fs.writeFileSync(tmp, sql, 'utf8');
  const res = spawnSync(`npx supabase db query --linked -f "${tmp}" > "${out}" 2> "${out}.err"`, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_INTERNAL_NO_TELEMETRY: '1', PGCLIENTENCODING: 'UTF8' },
    timeout: 90000
  });
  let text = '';
  let errText = '';
  try { text = fs.readFileSync(out, 'utf8'); } catch { /* ignore */ }
  try { errText = fs.readFileSync(`${out}.err`, 'utf8'); } catch { /* ignore */ }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  try { fs.unlinkSync(out); } catch { /* ignore */ }
  try { fs.unlinkSync(`${out}.err`); } catch { /* ignore */ }
  if (errText && /authentication failed|ECIRCUITBREAKER|failed to connect/i.test(errText)) {
    return { ok: false, rows: [], error: errText.slice(0, 400) };
  }
  if (res.status !== 0 && !text.includes('{')) {
    return { ok: false, rows: [], error: errText.slice(0, 400) || `exit ${res.status}` };
  }
  const start = text.indexOf('{');
  if (start < 0) return { ok: false, rows: [], error: 'no_json' };
  try {
    const parsed = JSON.parse(text.slice(start));
    return { ok: true, rows: parsed.rows || [] };
  } catch {
    return { ok: false, rows: [], error: 'json_parse' };
  }
}

function localSqlJson(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
  );
  if (res.status !== 0) return [];
  const raw = (res.stdout || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function inventory(config) {
  const remoteBuckets = remoteSqlJson(`select id, name, public from storage.buckets order by id`);
  const remoteObjects = remoteSqlJson(`select bucket_id, name from storage.objects order by bucket_id, name`);

  if (remoteBuckets.ok && remoteObjects.ok) {
    return {
      source: 'remote_sql',
      buckets: remoteBuckets.rows,
      objects: remoteObjects.rows
    };
  }

  const buckets = localSqlJson(
    config,
    `select coalesce(json_agg(json_build_object('id', id, 'name', name, 'public', public) order by id), '[]'::json)::text from storage.buckets`
  );
  const objects = localSqlJson(
    config,
    `select coalesce(json_agg(json_build_object('bucket_id', bucket_id, 'name', name) order by bucket_id, name), '[]'::json)::text from storage.objects`
  );

  return {
    source: 'local_mirror',
    buckets,
    objects,
    remoteError: remoteBuckets.error || remoteObjects.error || null
  };
}

function isNotFoundError(err) {
  const msg = String(err?.message || err || '');
  return /not[_ ]found|404/i.test(msg);
}

async function downloadObject(supabase, baseUrl, serviceKey, bucketId, objectPath) {
  const errors = [];

  // 1) SDK download
  {
    const { data, error } = await supabase.storage.from(bucketId).download(objectPath);
    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
    if (error) errors.push(`sdk:${error.message}`);
  }

  // 2) Signed URL + fetch
  {
    const { data, error } = await supabase.storage.from(bucketId).createSignedUrl(objectPath, 120);
    if (!error && data?.signedUrl) {
      const res = await fetch(data.signedUrl);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      errors.push(`signed:${res.status}`);
    } else if (error) {
      errors.push(`signed:${error.message}`);
    }
  }

  // 3) Raw Storage REST (service_role)
  const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
  const url = `${baseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucketId)}/${encoded}`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    }
  });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  let detail = '';
  try { detail = await res.text(); } catch { /* ignore */ }
  errors.push(`http:${res.status}:${detail.slice(0, 160)}`);
  const err = new Error(errors.join(' | '));
  err.notFound = res.status === 404 || /not_found/i.test(detail) || errors.some((e) => /not[_ ]found|404/i.test(e));
  throw err;
}

/** Confirm blob exists via Storage list (authoritative for binary presence). */
async function blobExists(supabase, bucketId, objectPath) {
  const idx = objectPath.lastIndexOf('/');
  const folder = idx >= 0 ? objectPath.slice(0, idx) : '';
  const fileName = idx >= 0 ? objectPath.slice(idx + 1) : objectPath;
  const { data, error } = await supabase.storage.from(bucketId).list(folder || undefined, {
    limit: 1000,
    search: fileName
  });
  if (error) return null;
  return (data || []).some((x) => x.name === fileName);
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);
  fs.mkdirSync(config.paths.storage, { recursive: true });

  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const inv = inventory(config);
  const buckets = inv.buckets || [];
  const objects = inv.objects || [];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(config.paths.storage, `storage_backup_${stamp}`);
  fs.mkdirSync(runDir, { recursive: true });

  const manifest = {
    version: 3,
    createdAt: new Date().toISOString(),
    source: config.supabase.url,
    inventorySource: inv.source,
    inventoryNote: inv.remoteError || null,
    buckets: [],
    orphans: [],
    totals: { buckets: 0, files: 0, bytes: 0, failed: 0, orphaned: 0 }
  };

  const byBucket = new Map();
  for (const b of buckets) {
    byBucket.set(b.id, {
      id: b.id,
      name: b.name || b.id,
      public: !!b.public,
      fileCount: 0,
      bytes: 0,
      files: [],
      failures: []
    });
  }
  for (const o of objects) {
    if (!byBucket.has(o.bucket_id)) {
      byBucket.set(o.bucket_id, {
        id: o.bucket_id,
        name: o.bucket_id,
        public: false,
        fileCount: 0,
        bytes: 0,
        files: [],
        failures: []
      });
    }
  }

  for (const [bucketId, bucketInfo] of byBucket) {
    const bucketDir = path.join(runDir, bucketId);
    fs.mkdirSync(bucketDir, { recursive: true });
    const files = objects.filter((o) => o.bucket_id === bucketId);

    for (const file of files) {
      try {
        const exists = await blobExists(supabase, bucketId, file.name);
        if (exists === false) {
          const orphan = {
            bucket: bucketId,
            path: file.name,
            reason: 'metadata_without_blob'
          };
          manifest.orphans.push(orphan);
          bucketInfo.failures.push({ ...orphan, error: 'orphaned_metadata_no_blob' });
          manifest.totals.orphaned += 1;
          appendSyncLog(config, 'warn', 'storage_orphan_metadata', orphan);
          continue;
        }

        const buf = await downloadObject(
          supabase,
          config.supabase.url,
          config.supabase.serviceRoleKey,
          bucketId,
          file.name
        );
        const dest = path.join(bucketDir, file.name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        const rec = { path: file.name, size: buf.length, sha256: sha256(buf) };
        bucketInfo.files.push(rec);
        bucketInfo.fileCount += 1;
        bucketInfo.bytes += buf.length;
        manifest.totals.files += 1;
        manifest.totals.bytes += buf.length;
      } catch (err) {
        if (err.notFound || isNotFoundError(err)) {
          const orphan = {
            bucket: bucketId,
            path: file.name,
            reason: 'download_not_found',
            error: String(err.message || err)
          };
          manifest.orphans.push(orphan);
          bucketInfo.failures.push({ path: file.name, error: 'orphaned_metadata_no_blob', detail: orphan.error });
          manifest.totals.orphaned += 1;
          appendSyncLog(config, 'warn', 'storage_orphan_metadata', orphan);
          continue;
        }
        bucketInfo.failures.push({ path: file.name, error: String(err.message || err) });
        manifest.totals.failed += 1;
        appendSyncLog(config, 'error', 'storage_download_failed', {
          bucket: bucketId,
          path: file.name,
          error: String(err.message || err)
        });
      }
    }

    manifest.buckets.push(bucketInfo);
    manifest.totals.buckets += 1;
    fs.writeFileSync(path.join(bucketDir, '_manifest.json'), JSON.stringify(bucketInfo, null, 2));
  }

  const manifestPath = path.join(runDir, 'MANIFEST.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(config.paths.storage, 'LATEST.json'),
    JSON.stringify({ runDir, manifestPath, createdAt: manifest.createdAt, totals: manifest.totals }, null, 2)
  );

  appendSyncLog(config, 'info', 'storage_backup_ok', { runDir, totals: manifest.totals, inventorySource: inv.source });
  // Orphaned metadata (DB row, missing blob) is reported but does not fail the backup of real files.
  const ok = manifest.totals.failed === 0;
  console.log(JSON.stringify({
    ok,
    runDir,
    totals: manifest.totals,
    orphans: manifest.orphans,
    inventorySource: inv.source
  }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
