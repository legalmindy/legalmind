import type JSZip from 'jszip';
import { BACKUP_MANIFEST_VERSION, BACKUP_TABLES } from './backupTypes';
import type { BackupIntegrityResult, BackupManifestV3, BackupTable, RestoreValidationResult } from './backupTypes';
export function backupLog(stage: string, detail?: string): void {
  const ts = new Date().toISOString();
  const msg = detail ? `[backup ${ts}] ${stage}: ${detail}` : `[backup ${ts}] ${stage}`;
  console.info(msg);
}

async function loadJsonArray(zip: JSZip, path: string): Promise<Record<string, unknown>[]> {
  const file = zip.file(path);
  if (!file) return [];
  try {
    const parsed = JSON.parse(await file.async('string')) as unknown;
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

export async function computeBackupChecksum(zip: JSZip, tables: BackupTable[]): Promise<string> {
  const parts: string[] = [];
  for (const table of tables) {
    const rows = await loadJsonArray(zip, `data/raw/${table}.json`);
    parts.push(`${table}:${rows.length}:${JSON.stringify(rows.map((r) => r.id ?? ''))}`);
  }
  const settings = zip.file('settings/office.json');
  if (settings) parts.push(await settings.async('string'));

  const data = parts.join('|');
  const buffer = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function countBackupRecords(zip: JSZip, tables: BackupTable[]): Promise<Partial<Record<BackupTable, number>>> {
  const counts: Partial<Record<BackupTable, number>> = {};
  for (const table of tables) {
    if (table === 'documents') {
      const manifest = await loadJsonArray(zip, 'documents/manifest.json');
      counts.documents = manifest.filter((r) => !r.error).length;
      continue;
    }
    if (table === 'case_attachments') {
      const manifest = await loadJsonArray(zip, 'attachments/manifest.json');
      counts.case_attachments = manifest.filter((r) => !r.error).length;
      continue;
    }
    const raw = await loadJsonArray(zip, `data/raw/${table}.json`);
    const display = raw.length ? raw : await loadJsonArray(zip, `data/${table}.json`);
    counts[table] = display.length;
  }
  return counts;
}

export function parseManifest(raw: unknown): BackupManifestV3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const version = Number(m.version ?? 0);
  if (version < 2) return null;

  return {
    version,
    firm_id: String(m.firm_id ?? ''),
    firm_name: String(m.firm_name ?? ''),
    created_at: String(m.created_at ?? ''),
    tables: (m.tables as BackupTable[]) ?? [],
    record_counts: (m.record_counts as Partial<Record<BackupTable, number>>) ?? {},
    total_records: Number(m.total_records ?? 0),
    checksum: String(m.checksum ?? ''),
    settings_included: Boolean(m.settings_included ?? zipHasSettings(m)),
    documents_included: Boolean(m.documents_included ?? (m.tables as string[] | undefined)?.includes('documents'))
  };
}

function zipHasSettings(m: Record<string, unknown>): boolean {
  return Boolean(m.settings_included);
}

export async function validateBackupZip(zip: JSZip, sizeBytes: number): Promise<BackupIntegrityResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    return {
      valid: false,
      errors: ['manifest.json مفقود'],
      warnings: [],
      recordCounts: {},
      totalRecords: 0,
      checksum: '',
      sizeBytes
    };
  }

  let manifest: BackupManifestV3 | null = null;
  try {
    manifest = parseManifest(JSON.parse(await manifestFile.async('string')));
  } catch {
    errors.push('manifest.json تالف أو غير قابل للقراءة');
  }

  if (!manifest) {
    errors.push('إصدار النسخة الاحتياطية غير مدعوم (يتطلب الإصدار 2 أو أحدث)');
  } else if (manifest.version < BACKUP_MANIFEST_VERSION) {
    warnings.push(`نسخة احتياطية قديمة (v${manifest.version}) — الاستعادة مدعومة مع تحذيرات`);
  }

  if (!zip.file('settings/office.json')) {
    warnings.push('إعدادات المكتب غير موجودة في النسخة');
  }

  const tables = (manifest?.tables?.length ? manifest.tables : BACKUP_TABLES) as BackupTable[];
  const recordCounts = await countBackupRecords(zip, tables);
  const totalRecords = Object.values(recordCounts).reduce((sum, n) => sum + (n ?? 0), 0);

  if (totalRecords === 0 && !zip.file('settings/office.json')) {
    errors.push('النسخة الاحتياطية فارغة — لا توجد بيانات للاستعادة');
  }

  if (sizeBytes < 100) {
    errors.push('حجم الملف صغير جداً — قد يكون تالفاً');
  }

  if (manifest?.record_counts && manifest.version >= BACKUP_MANIFEST_VERSION) {
    for (const [table, expected] of Object.entries(manifest.record_counts)) {
      const actual = recordCounts[table as BackupTable] ?? 0;
      if (expected !== undefined && expected !== actual) {
        warnings.push(`عدد سجلات ${table}: متوقع ${expected}، وُجد ${actual}`);
      }
    }
  }

  let checksum = '';
  if (manifest && manifest.version >= BACKUP_MANIFEST_VERSION) {
    checksum = await computeBackupChecksum(zip, tables);
    if (manifest.checksum && manifest.checksum !== checksum) {
      errors.push('فحص سلامة المحتوى (checksum) فشل — قد تكون النسخة تالفة');
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    recordCounts,
    totalRecords,
    checksum,
    sizeBytes
  };
}

export async function validateRestoredData(
  firmId: string,
  expectedCounts: Partial<Record<BackupTable, number>>,
  restoredCounts: Record<string, number>
): Promise<RestoreValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingForeignKeys: string[] = [];
  const duplicateIds: string[] = [];

  for (const [table, expected] of Object.entries(expectedCounts)) {
    const restoredKey = Object.keys(restoredCounts).find((k) => k.startsWith(table));
    const restored = restoredKey ? (restoredCounts[restoredKey] ?? 0) : 0;
    if (expected && restored < expected) {
      warnings.push(`${table}: استُعيد ${restored} من ${expected} سجل`);    }
  }

  if (!firmId) {
    errors.push('معرّف المكتب غير متوفر للتحقق');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    restoredCounts,
    missingForeignKeys,
    duplicateIds
  };
}
