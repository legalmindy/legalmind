import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { fetchOffice, getCurrentFirmId } from './api';
import { collectRawBackupRows } from './backupCollect';
import { restoreFirmBackupData } from './backupRestore';
import {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TABLES,
  type BackupIntegrityResult,
  type BackupManifestV3,
  type BackupTable
} from './backupTypes';
import {
  backupLog,
  computeBackupChecksum,
  countBackupRecords,
  parseManifest,
  validateBackupZip,
  validateRestoredData
} from './backupValidation';
import { collectEntityRows, downloadCaseAttachmentsZip, downloadDocumentsZip, type ExportEntity } from './dataExport';
import { registerFirmBackup, registerFirmBackupStorage } from './securityApi';
import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

const DISPLAY_EXPORT_ENTITIES: ExportEntity[] = [
  'clients',
  'cases',
  'sessions',
  'payments',
  'receipts',
  'expenses',
  'employees',
  'documents'
];

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface BackupCreateResult {
  backupId: string;
  filename: string;
  sizeBytes: number;
  recordCounts: Partial<Record<BackupTable, number>>;
  totalRecords: number;
  integrity: BackupIntegrityResult;
}

export interface BackupCreateOptions {
  uploadToServer?: boolean;
}

export async function createFirmBackup(options: BackupCreateOptions = {}): Promise<BackupCreateResult> {
  backupLog('create', 'start');
  const firmId = await getCurrentFirmId();
  const office = await fetchOffice();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zip = new JSZip();
  let fileCount = 0;
  const tablesIncluded: string[] = [];
  const recordCounts: Partial<Record<BackupTable, number>> = {};

  zip.file(
    'settings/office.json',
    JSON.stringify(
      {
        name: office.name,
        license_no: office.licenseNo,
        plan: office.plan,
        subscription_status: office.subscriptionStatus,
        subscription_plan: office.subscriptionPlan,
        reminders_enabled: office.remindersEnabled,
        whatsapp_reports_enabled: office.whatsappReportsEnabled,
        sms_reports_enabled: office.smsReportsEnabled,
        hide_financials_from_trainees: office.hideFinancialsFromTrainees
      },
      null,
      2
    )
  );
  fileCount += 1;
  tablesIncluded.push('settings');

  for (const entity of BACKUP_TABLES) {
    if (entity === 'documents') {
      backupLog('create', 'documents');
      const { blob, count } = await downloadDocumentsZip({});
      const inner = await JSZip.loadAsync(blob);
      for (const [path, file] of Object.entries(inner.files)) {
        if (!file.dir) {
          zip.file(path, await file.async('blob'));
          fileCount += 1;
        }
      }
      const rawDocs = await collectRawBackupRows('documents', firmId);
      if (rawDocs.length) {
        zip.file('data/raw/documents.json', JSON.stringify(rawDocs, null, 2));
        fileCount += 1;
      }
      recordCounts.documents = count;
      if (count > 0 || rawDocs.length) tablesIncluded.push(entity);
      continue;
    }

    if (entity === 'case_attachments') {
      backupLog('create', 'case_attachments');
      const { blob, count } = await downloadCaseAttachmentsZip();
      const inner = await JSZip.loadAsync(blob);
      for (const [path, file] of Object.entries(inner.files)) {
        if (!file.dir) {
          zip.file(path, await file.async('blob'));
          fileCount += 1;
        }
      }
      const rawRows = await collectRawBackupRows('case_attachments', firmId);
      if (rawRows.length) {
        zip.file('data/raw/case_attachments.json', JSON.stringify(rawRows, null, 2));
        fileCount += 1;
      }
      recordCounts.case_attachments = count;
      if (count > 0 || rawRows.length) tablesIncluded.push(entity);
      continue;
    }

    const rawRows = await collectRawBackupRows(entity, firmId);
    recordCounts[entity] = rawRows.length;
    if (!rawRows.length) continue;

    zip.file(`data/raw/${entity}.json`, JSON.stringify(rawRows, null, 2));
    fileCount += 1;

    if (DISPLAY_EXPORT_ENTITIES.includes(entity as ExportEntity)) {
      const rows = await collectEntityRows(entity as ExportEntity, {});
      if (rows.length) {
        zip.file(`data/${entity}.json`, JSON.stringify(rows, null, 2));
        const sheet = XLSX.utils.json_to_sheet(rows);
        zip.file(`data/${entity}.csv`, '\uFEFF' + XLSX.utils.sheet_to_csv(sheet));
        fileCount += 2;
      }
    }

    tablesIncluded.push(entity);
    backupLog('create', `${entity}: ${rawRows.length} rows`);
  }

  const totalRecords = Object.values(recordCounts).reduce((sum, n) => sum + (n ?? 0), 0);

  const preManifest: BackupManifestV3 = {
    version: BACKUP_MANIFEST_VERSION,
    firm_id: firmId,
    firm_name: office.name,
    created_at: new Date().toISOString(),
    tables: BACKUP_TABLES,
    record_counts: recordCounts,
    total_records: totalRecords,
    checksum: '',
    settings_included: true,
    documents_included: (recordCounts.documents ?? 0) > 0
  };

  zip.file('manifest.json', JSON.stringify(preManifest, null, 2));
  fileCount += 1;

  const preBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const preZip = await JSZip.loadAsync(preBlob);
  const checksum = await computeBackupChecksum(preZip, BACKUP_TABLES);

  const manifest: BackupManifestV3 = { ...preManifest, checksum };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const integrityZip = await JSZip.loadAsync(blob);
  const integrity = await validateBackupZip(integrityZip, blob.size);

  if (!integrity.valid) {
    backupLog('create', `integrity failed: ${integrity.errors.join('; ')}`);
    throw new Error(`فشل التحقق من سلامة النسخة: ${integrity.errors.join(' — ')}`);
  }

  const filename = `legalmind-backup-${office.name.replace(/[/\\?%*:|"<>]/g, '-')}-${stamp.slice(0, 10)}.zip`;
  triggerDownload(blob, filename);

  let backupId: string;
  const storagePath = `${firmId}/${stamp}-${filename}`;

  if (options.uploadToServer) {
    const { error: uploadError } = await supabase.storage.from('firm-backups').upload(storagePath, blob, {
      upsert: true,
      contentType: 'application/zip'
    });
    if (uploadError) {
      backupLog('create', `server upload failed: ${uploadError.message}`);
      backupId = await registerFirmBackup(
        blob.size,
        fileCount,
        tablesIncluded,
        `نسخة احتياطية — ${office.name} (${totalRecords} سجل) — فشل الرفع للسحابة`
      );
    } else {
      backupId = await registerFirmBackupStorage(
        storagePath,
        blob.size,
        fileCount,
        tablesIncluded,
        `نسخة سحابية — ${office.name} (${totalRecords} سجل)`
      );
      backupLog('create', `uploaded to firm-backups/${storagePath}`);
    }
  } else {
    backupId = await registerFirmBackup(
      blob.size,
      fileCount,
      tablesIncluded,
      `نسخة احتياطية — ${office.name} (${totalRecords} سجل)`
    );
  }

  backupLog('create', `complete — ${filename} (${blob.size} bytes, ${totalRecords} records)`);

  return {
    backupId,
    filename,
    sizeBytes: blob.size,
    recordCounts,
    totalRecords,
    integrity
  };
}

export interface BackupRestorePreview {
  firmName?: string;
  firmId?: string;
  createdAt?: string;
  version?: number;
  tables: string[];
  recordCounts?: Partial<Record<BackupTable, number>>;
  totalRecords?: number;
  settings?: Record<string, unknown>;
  integrity?: BackupIntegrityResult;
}

export async function previewBackupRestore(file: File): Promise<BackupRestorePreview> {
  backupLog('preview', file.name);
  const zip = await JSZip.loadAsync(file);
  const integrity = await validateBackupZip(zip, file.size);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('ملف النسخة الاحتياطية غير صالح — manifest.json مفقود');

  const manifest = parseManifest(JSON.parse(await manifestFile.async('string')));
  if (!manifest) throw new Error('إصدار النسخة الاحتياطية غير مدعوم');

  let settings: Record<string, unknown> | undefined;
  const settingsFile = zip.file('settings/office.json');
  if (settingsFile) {
    settings = JSON.parse(await settingsFile.async('string')) as Record<string, unknown>;
  }

  const tables = manifest.tables?.length ? manifest.tables : BACKUP_TABLES;
  const recordCounts = integrity.recordCounts ?? (await countBackupRecords(zip, tables));

  return {
    firmName: manifest.firm_name,
    firmId: manifest.firm_id,
    createdAt: manifest.created_at,
    version: manifest.version,
    tables,
    recordCounts,
    totalRecords: integrity.totalRecords,
    settings,
    integrity
  };
}

export interface RestoreFirmBackupResult {
  restored: string[];
  warnings: string[];
  documentFailures: string[];
  validation: Awaited<ReturnType<typeof validateRestoredData>>;
}

export async function restoreFirmBackup(file: File): Promise<RestoreFirmBackupResult> {
  backupLog('restore', file.name);
  const preview = await previewBackupRestore(file);

  if (preview.integrity && !preview.integrity.valid) {
    throw new Error(`النسخة الاحتياطية غير صالحة: ${preview.integrity.errors.join(' — ')}`);
  }

  const currentFirmId = await getCurrentFirmId();
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  const manifest = parseManifest(JSON.parse((await manifestFile!.async('string')) as string));

  if (manifest?.firm_id && manifest.firm_id !== currentFirmId) {
    throw new Error('هذه النسخة الاحتياطية تخص مكتباً آخر ولا يمكن استعادتها هنا.');
  }

  const restoredSections: string[] = [];

  if (preview.settings) {
    const update: Record<string, unknown> = {};
    if (preview.settings.reminders_enabled !== undefined) update.reminders_enabled = preview.settings.reminders_enabled;
    if (preview.settings.whatsapp_reports_enabled !== undefined) {
      update.whatsapp_reports_enabled = preview.settings.whatsapp_reports_enabled;
    }
    if (preview.settings.sms_reports_enabled !== undefined) update.sms_reports_enabled = preview.settings.sms_reports_enabled;
    if (preview.settings.hide_financials_from_trainees !== undefined) {
      update.hide_financials_from_trainees = preview.settings.hide_financials_from_trainees;
    }

    if (Object.keys(update).length) {
      const { error } = await supabase.from('firms').update(update).eq('id', currentFirmId);
      throwIfSupabaseError(error);
      restoredSections.push('settings');
    }
  }

  const { restored, warnings, documentFailures } = await restoreFirmBackupData(zip);
  restoredSections.push(...restored);

  if (!restoredSections.length) {
    throw new Error('لم يُعثر على بيانات قابلة للاستعادة في هذا الملف.');
  }

  const restoredCounts: Record<string, number> = {};
  for (const item of restored) {
    const match = item.match(/^(\w+)\s*\((\d+)\)$/);
    if (match) restoredCounts[match[1]!] = Number(match[2]);
  }

  const validation = await validateRestoredData(
    currentFirmId,
    preview.recordCounts ?? {},
    restoredCounts
  );

  await registerFirmBackup(
    file.size,
    restoredSections.length,
    restoredSections.map((item) => item.split(' ')[0] ?? item),
    `استعادة — ${preview.firmName ?? 'مكتب'}`
  );

  backupLog('restore', `complete — ${restoredSections.join(', ')}`);

  return {
    restored: restoredSections,
    warnings: [...warnings, ...validation.warnings, ...(preview.integrity?.warnings ?? [])],
    documentFailures,
    validation
  };
}
