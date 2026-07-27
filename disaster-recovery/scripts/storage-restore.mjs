/**
 * Restore Storage files from a local storage_backup_* directory into a Supabase project.
 * SAFETY:
 * - Never deletes remote objects.
 * - Uses upsert upload only.
 * - Refuses production URL unless --allow-production-upload is set.
 * - --dry-run verifies local integrity only (no network writes).
 *
 * Usage:
 *   node storage-restore.mjs --source D:\LegalMind_Backups\storage\storage_backup_XXXX --dry-run
 *   node storage-restore.mjs --source ... --target-url https://NEW.supabase.co --service-role KEY
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadDrConfig, ensureDirs, appendSyncLog } from './lib/config.mjs';

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveSource(config, sourceArg) {
  if (sourceArg && fs.existsSync(sourceArg)) return sourceArg;
  const latest = path.join(config.paths.root, 'storage', 'LATEST.json');
  if (fs.existsSync(latest)) {
    const j = JSON.parse(fs.readFileSync(latest, 'utf8'));
    if (j.runDir && fs.existsSync(j.runDir)) return j.runDir;
  }
  throw new Error('Provide --source path to a storage_backup_* directory (or create one via storage-backup.mjs)');
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);
  config.paths.storage = path.join(config.paths.root, 'storage');

  const source = resolveSource(config, arg('--source'));
  const dryRun = hasFlag('--dry-run');
  const manifestPath = path.join(source, 'MANIFEST.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`MANIFEST.json missing in ${source}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const report = {
    source,
    dryRun,
    createdAt: new Date().toISOString(),
    buckets: [],
    verifiedFiles: 0,
    uploadedFiles: 0,
    failed: [],
    checksumMismatches: []
  };

  // Local integrity first
  for (const bucket of manifest.buckets || []) {
    const bucketReport = { id: bucket.id, checked: 0, ok: 0, missing: 0 };
    for (const file of bucket.files || []) {
      const localPath = path.join(source, bucket.id, file.path);
      bucketReport.checked += 1;
      if (!fs.existsSync(localPath)) {
        bucketReport.missing += 1;
        report.failed.push({ bucket: bucket.id, path: file.path, error: 'missing_local_file' });
        continue;
      }
      const hash = sha256File(localPath);
      if (file.sha256 && hash !== file.sha256) {
        report.checksumMismatches.push({ bucket: bucket.id, path: file.path, expected: file.sha256, actual: hash });
      } else {
        bucketReport.ok += 1;
        report.verifiedFiles += 1;
      }
    }
    report.buckets.push(bucketReport);
  }

  if (dryRun) {
    appendSyncLog(config, 'info', 'storage_restore_dry_run', report);
    console.log(JSON.stringify({ ok: report.failed.length === 0 && report.checksumMismatches.length === 0, ...report }, null, 2));
    process.exit(report.failed.length || report.checksumMismatches.length ? 2 : 0);
  }

  const targetUrl = arg('--target-url') || config.supabase.url;
  const serviceKey = arg('--service-role') || config.supabase.serviceRoleKey;
  if (!targetUrl || !serviceKey) throw new Error('target URL and service role required for upload');

  const prodHost = (() => {
    try { return new URL(config.supabase.url).host; } catch { return ''; }
  })();
  const targetHost = (() => {
    try { return new URL(targetUrl).host; } catch { return ''; }
  })();

  if (prodHost && targetHost === prodHost && !hasFlag('--allow-production-upload')) {
    throw new Error(
      'Refusing to upload into production Storage. Pass --allow-production-upload only with explicit approval, or use --target-url for a NEW project.'
    );
  }

  const supabase = createClient(targetUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Ensure buckets exist (create if missing — non-destructive)
  const { data: existing } = await supabase.storage.listBuckets();
  const existingIds = new Set((existing || []).map((b) => b.id));
  for (const bucket of manifest.buckets || []) {
    if (!existingIds.has(bucket.id)) {
      const { error } = await supabase.storage.createBucket(bucket.id, {
        public: !!bucket.public
      });
      if (error && !/already exists/i.test(error.message)) {
        report.failed.push({ bucket: bucket.id, path: '(bucket)', error: error.message });
        continue;
      }
    }

    for (const file of bucket.files || []) {
      const localPath = path.join(source, bucket.id, file.path);
      if (!fs.existsSync(localPath)) continue;
      const buf = fs.readFileSync(localPath);
      const { error } = await supabase.storage.from(bucket.id).upload(file.path, buf, {
        upsert: true,
        contentType: file.mimetype || undefined
      });
      if (error) {
        report.failed.push({ bucket: bucket.id, path: file.path, error: error.message });
      } else {
        report.uploadedFiles += 1;
      }
    }
  }

  appendSyncLog(config, report.failed.length ? 'warn' : 'info', 'storage_restore_done', report);
  console.log(JSON.stringify({ ok: report.failed.length === 0, ...report }, null, 2));
  process.exit(report.failed.length ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
