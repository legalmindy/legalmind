/**
 * Investigate Storage orphan metadata (READ production / local mirror only).
 * Never deletes or modifies production data.
 *
 *   npm run dr:orphan-audit
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadDrConfig, ensureDirs, appendSyncLog, localConnEnv } from './lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function localSql(config, sql) {
  const res = spawnSync(
    config.local.psqlPath,
    ['-h', config.local.host, '-p', String(config.local.port), '-U', config.local.user, '-d', config.local.database, '-tAc', sql],
    { env: localConnEnv(config), encoding: 'utf8' }
  );
  if (res.status !== 0) return { ok: false, out: '', err: res.stderr || res.stdout };
  return { ok: true, out: (res.stdout || '').trim() };
}

function localJson(config, sql) {
  const r = localSql(config, sql);
  if (!r.ok || !r.out) return [];
  try {
    const parsed = JSON.parse(r.out);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function blobExists(supabase, bucketId, objectPath) {
  const idx = objectPath.lastIndexOf('/');
  const folder = idx >= 0 ? objectPath.slice(0, idx) : '';
  const fileName = idx >= 0 ? objectPath.slice(idx + 1) : objectPath;
  const { data, error } = await supabase.storage.from(bucketId).list(folder || undefined, {
    limit: 1000,
    search: fileName
  });
  if (error) return { exists: null, error: error.message };
  return { exists: (data || []).some((x) => x.name === fileName), error: null };
}

async function tryDownload(supabase, bucketId, objectPath) {
  const { data, error } = await supabase.storage.from(bucketId).download(objectPath);
  if (!error && data) {
    const buf = Buffer.from(await data.arrayBuffer());
    return { ok: true, size: buf.length };
  }
  return { ok: false, error: error?.message || 'download_failed' };
}

function explainOrphan(row, refs, probe) {
  const meta = row.metadata || {};
  const hadSuccessfulUpload =
    meta.httpStatusCode === 200 || meta.eTag || meta.size || meta.contentLength;

  const reasons = [];
  if (probe.listExists === false && probe.downloadOk === false) {
    reasons.push(
      'صف في storage.objects موجود، لكن الـ blob غير موجود في محرّك Storage (list=false + download فشل).'
    );
  }
  if (hadSuccessfulUpload) {
    reasons.push(
      `metadata تشير إلى رفع ناجح سابقاً (size=${meta.size ?? meta.contentLength ?? '?'}, eTag=${meta.eTag ? 'yes' : 'no'}, httpStatus=${meta.httpStatusCode ?? '?'}). إذن الملف وُجد ثم فُقد/حُذف من الطبقة الثنائية دون حذف صف الـ metadata.`
    );
  } else {
    reasons.push('لا توجد أدلة metadata على اكتمال الرفع — قد يكون الرفع فشل جزئياً.');
  }
  if (refs.subscription_requests?.length || refs.payments?.length) {
    reasons.push(
      'سجلات التطبيق ما زالت تشير إلى هذا المسار (subscription_requests / payments). الحالة التجارية قد تكون مكتملة (approved) بينما صورة الإيصال غير قابلة للعرض.'
    );
  }
  if (String(refs.sampleReceiptUrl || '').includes('/object/public/') && row.bucket_public === false) {
    reasons.push(
      'ملاحظة تطبيق: receipt_url يستخدم مسار public بينما الـ bucket خاص (private). هذا لا يسبب اختفاء الـ blob، لكنه يجعل الرابط العام غير صالح؛ العرض يعتمد على signed URL.'
    );
  }

  return {
    canAutoFixWithoutProdWrite: false,
    recoverableFromBackup: false,
    businessImpact: refs.subscription_requests?.some((r) => r.status === 'approved')
      ? 'منخفض للأعمال (الطلب معتمد) — مرتفع لعرض الإيصال فقط'
      : 'متوسط — قد يمنع مراجعة الإيصال',
    rootCauseSummaryAr: reasons.join(' '),
    recommendedManualActions: [
      'لا تحذف صف metadata تلقائياً أثناء تدقيق DR.',
      'اطلب من المكتب إعادة رفع إيصال إن لزم عرض الصورة لاحقاً.',
      'اختياري لاحقاً (بموافقة صريحة): حذف صف orphan من storage.objects فقط بعد التأكد أن لا حاجة للملف.',
      'أبقِ النسخ الاحتياطي يسجّل orphans في MANIFEST دون اعتبارها فشل نسخ للملفات الحقيقية.'
    ]
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# تدقيق ملفات Storage اليتيمة (Orphans)');
  lines.push(`**التاريخ:** ${report.generatedAt}`);
  lines.push('**السلامة:** قراءة فقط — لم يُحذف ولم يُعدَّل أي شيء في الإنتاج.');
  lines.push('');
  lines.push(`## الخلاصة`);
  lines.push(`- عدد orphans: **${report.orphans.length}**`);
  lines.push(`- ملفات قابلة للنسخ: تُعالَج عبر \`npm run dr:storage-backup\``);
  lines.push('');
  if (!report.orphans.length) {
    lines.push('لا توجد ملفات يتيمة حالياً.');
    return lines.join('\n');
  }
  for (const o of report.orphans) {
    lines.push(`## Orphan: \`${o.bucket_id}/${o.name}\``);
    lines.push(`- object id: \`${o.id}\``);
    lines.push(`- owner: \`${o.owner || 'n/a'}\``);
    lines.push(`- created_at: ${o.created_at}`);
    lines.push(`- metadata: \`${JSON.stringify(o.metadata || {})}\``);
    lines.push(`- list exists: ${o.probe?.listExists}`);
    lines.push(`- download: ${o.probe?.downloadOk ? 'ok' : o.probe?.downloadError}`);
    lines.push(`- firm: ${o.refs?.firm_name || o.refs?.firm_id || 'n/a'}`);
    lines.push(`- subscription_requests: ${o.refs?.subscription_requests?.length || 0}`);
    lines.push(`- payments: ${o.refs?.payments?.length || 0}`);
    lines.push('');
    lines.push(`### السبب`);
    lines.push(o.analysis.rootCauseSummaryAr);
    lines.push('');
    lines.push(`### الأثر: ${o.analysis.businessImpact}`);
    lines.push(`### هل يُستعاد من النسخة؟ **لا** (لا يوجد blob للنسخ)`);
    lines.push('');
    lines.push('### إجراءات يدوية موصى بها');
    for (const a of o.analysis.recommendedManualActions) lines.push(`- ${a}`);
    lines.push('');
  }
  lines.push('## SQL اختياري للتنظيف لاحقاً (لا يُنفَّذ تلقائياً)');
  lines.push('```sql');
  lines.push('-- ONLY with explicit human approval — deletes metadata rows, not blobs');
  for (const o of report.orphans) {
    lines.push(`-- delete from storage.objects where id = '${o.id}'; -- ${o.bucket_id}/${o.name}`);
  }
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const config = loadDrConfig();
  ensureDirs(config);

  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const objects = localJson(
    config,
    `select coalesce(json_agg(json_build_object(
      'id', o.id,
      'bucket_id', o.bucket_id,
      'name', o.name,
      'owner', o.owner,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'metadata', o.metadata,
      'bucket_public', b.public
    ) order by o.bucket_id, o.name), '[]'::json)::text
    from storage.objects o
    left join storage.buckets b on b.id = o.bucket_id`
  );

  const report = {
    title: 'Storage orphan audit (read-only)',
    generatedAt: new Date().toISOString(),
    productionSafe: true,
    scannedObjects: objects.length,
    orphans: [],
    healthyFiles: 0
  };

  for (const row of objects) {
    const list = await blobExists(supabase, row.bucket_id, row.name);
    let downloadOk = false;
    let downloadError = null;
    let downloadSize = null;

    if (list.exists === true) {
      const dl = await tryDownload(supabase, row.bucket_id, row.name);
      downloadOk = dl.ok;
      downloadError = dl.error || null;
      downloadSize = dl.size ?? null;
    } else if (list.exists === false) {
      downloadOk = false;
      downloadError = 'skipped_download_list_missing';
    } else {
      // list inconclusive — try download
      const dl = await tryDownload(supabase, row.bucket_id, row.name);
      downloadOk = dl.ok;
      downloadError = dl.error || null;
      downloadSize = dl.size ?? null;
    }

    const isOrphan = list.exists === false || (list.exists !== true && !downloadOk);
    if (!isOrphan && downloadOk) {
      report.healthyFiles += 1;
      continue;
    }
    if (list.exists === true && downloadOk) {
      report.healthyFiles += 1;
      continue;
    }

    // Confirm orphan: missing blob
    if (list.exists === true && !downloadOk) {
      // permission/network failure — not classified as orphan
      continue;
    }

    const refs = {
      firm_id: null,
      firm_name: null,
      subscription_requests: localJson(
        config,
        `select coalesce(json_agg(json_build_object(
          'id', id, 'firm_id', firm_id, 'status', status,
          'receipt_path', receipt_path, 'receipt_url', receipt_url, 'created_at', created_at
        )), '[]'::json)::text
        from public.subscription_requests
        where receipt_path = '${row.name.replace(/'/g, "''")}'
           or receipt_url ilike '%${row.name.replace(/'/g, "''")}%'`
      ),
      payments: localJson(
        config,
        `select coalesce(json_agg(json_build_object(
          'id', id, 'firm_id', firm_id, 'status', status,
          'receipt_url', receipt_url, 'created_at', created_at
        )), '[]'::json)::text
        from public.payments
        where receipt_url ilike '%${row.name.replace(/'/g, "''")}%'`
      ),
      sampleReceiptUrl: null
    };
    if (refs.subscription_requests[0]) {
      refs.firm_id = refs.subscription_requests[0].firm_id;
      refs.sampleReceiptUrl = refs.subscription_requests[0].receipt_url;
    } else if (refs.payments[0]) {
      refs.firm_id = refs.payments[0].firm_id;
      refs.sampleReceiptUrl = refs.payments[0].receipt_url;
    }
    if (refs.firm_id) {
      const firm = localSql(
        config,
        `select coalesce(name,'') from public.firms where id = '${String(refs.firm_id).replace(/'/g, "''")}'`
      );
      refs.firm_name = firm.ok ? firm.out : null;
    }

    const probe = {
      listExists: list.exists,
      listError: list.error,
      downloadOk,
      downloadError,
      downloadSize
    };

    report.orphans.push({
      ...row,
      probe,
      refs,
      analysis: explainOrphan(row, refs, probe)
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outJson = path.join(config.paths.root, `STORAGE_ORPHAN_AUDIT_${stamp}.json`);
  const outMd = path.join(config.paths.root, 'STORAGE_ORPHAN_AUDIT_LATEST.md');
  const outRepo = path.join(ROOT, 'disaster-recovery', 'STORAGE_ORPHAN_AUDIT.md');

  const md = toMarkdown(report);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(outMd, md, 'utf8');
  fs.writeFileSync(outRepo, md, 'utf8');

  appendSyncLog(config, 'info', 'storage_orphan_audit_ok', {
    scanned: report.scannedObjects,
    orphans: report.orphans.length,
    healthy: report.healthyFiles
  });

  console.log(JSON.stringify({
    ok: true,
    scannedObjects: report.scannedObjects,
    healthyFiles: report.healthyFiles,
    orphanCount: report.orphans.length,
    orphans: report.orphans.map((o) => ({
      bucket: o.bucket_id,
      path: o.name,
      impact: o.analysis.businessImpact,
      recoverable: false
    })),
    outJson,
    outMd
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
