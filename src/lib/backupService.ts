import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { fetchOffice, getCurrentFirmId } from './api';
import { restoreFirmBackupData } from './backupRestore';
import {
  collectEntityRows,
  downloadDocumentsZip,
  type ExportEntity
} from './dataExport';
import { registerFirmBackup } from './securityApi';
import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

const BACKUP_ENTITIES: ExportEntity[] = [
  'clients',
  'cases',
  'sessions',
  'payments',
  'receipts',
  'expenses',
  'employees',
  'documents'
];

async function collectRawEntityRows(entity: ExportEntity, firmId: string): Promise<Record<string, unknown>[]> {
  switch (entity) {
    case 'clients': {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'cases': {
      const { data, error } = await supabase
        .from('cases')
        .select(
          'id, firm_id, client_id, assigned_lawyer_id, court_case_number, title, case_type, case_stage, category, court, description, total_amount, paid_amount, status, contract_currency, contract_date, notes, created_at'
        )
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'sessions': {
      const { data: cases, error: casesError } = await supabase
        .from('cases')
        .select('id')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(casesError);
      const caseIds = (cases ?? []).map((c) => c.id as string);
      if (!caseIds.length) return [];
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .in('case_id', caseIds)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'payments': {
      const { data, error } = await supabase
        .from('case_payments')
        .select('*')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'receipts': {
      const { data, error } = await supabase.from('receipt_vouchers').select('*').eq('firm_id', firmId);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'expenses': {
      const { data, error } = await supabase
        .from('office_expenses')
        .select('*')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'documents': {
      const { data: cases, error: casesError } = await supabase
        .from('cases')
        .select('id')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(casesError);
      const caseIds = (cases ?? []).map((c) => c.id as string);
      if (!caseIds.length) return [];
      const { data, error } = await supabase
        .from('documents')
        .select('id, case_id, title, category, file_type, file_size, storage_path, is_encrypted, uploaded_at')
        .in('case_id', caseIds)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    default:
      return [];
  }
}

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

export async function createFirmBackup(): Promise<{ backupId: string; filename: string; sizeBytes: number }> {
  const firmId = await getCurrentFirmId();
  const office = await fetchOffice();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zip = new JSZip();
  let fileCount = 0;
  const tablesIncluded: string[] = [];

  const manifest = {
    version: 2,
    firm_id: firmId,
    firm_name: office.name,
    created_at: new Date().toISOString(),
    tables: BACKUP_ENTITIES
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  fileCount += 1;

  zip.file(
    'settings/office.json',
    JSON.stringify(
      {
        name: office.name,
        license_no: office.licenseNo,
        plan: office.plan,
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

  for (const entity of BACKUP_ENTITIES) {
    if (entity === 'documents') {
      const { blob, count } = await downloadDocumentsZip({});
      const inner = await JSZip.loadAsync(blob);
      for (const [path, file] of Object.entries(inner.files)) {
        if (!file.dir) {
          zip.file(path, await file.async('blob'));
          fileCount += 1;
        }
      }
      if (count > 0) tablesIncluded.push(entity);
      continue;
    }

    const rows = await collectEntityRows(entity, {});
    const rawRows = entity === 'employees' ? [] : await collectRawEntityRows(entity, firmId);
    if (!rows.length && !rawRows.length) continue;

    if (rows.length) {
      zip.file(`data/${entity}.json`, JSON.stringify(rows, null, 2));
      const sheet = XLSX.utils.json_to_sheet(rows);
      zip.file(`data/${entity}.csv`, '\uFEFF' + XLSX.utils.sheet_to_csv(sheet));
      fileCount += 2;
    }
    if (rawRows.length) {
      zip.file(`data/raw/${entity}.json`, JSON.stringify(rawRows, null, 2));
      fileCount += 1;
    }
    tablesIncluded.push(entity);
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const filename = `legalmind-backup-${office.name.replace(/[/\\?%*:|"<>]/g, '-')}-${stamp.slice(0, 10)}.zip`;
  triggerDownload(blob, filename);

  const backupId = await registerFirmBackup(blob.size, fileCount, tablesIncluded, `نسخة احتياطية — ${office.name}`);
  return { backupId, filename, sizeBytes: blob.size };
}

export interface BackupRestorePreview {
  firmName?: string;
  createdAt?: string;
  tables: string[];
  settings?: Record<string, unknown>;
}

export async function previewBackupRestore(file: File): Promise<BackupRestorePreview> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('ملف النسخة الاحتياطية غير صالح — manifest.json مفقود');

  const manifest = JSON.parse(await manifestFile.async('string')) as {
    firm_name?: string;
    created_at?: string;
    tables?: string[];
  };

  let settings: Record<string, unknown> | undefined;
  const settingsFile = zip.file('settings/office.json');
  if (settingsFile) {
    settings = JSON.parse(await settingsFile.async('string')) as Record<string, unknown>;
  }

  return {
    firmName: manifest.firm_name,
    createdAt: manifest.created_at,
    tables: manifest.tables ?? [],
    settings
  };
}

export async function restoreFirmBackup(file: File): Promise<{ restored: string[] }> {
  const preview = await previewBackupRestore(file);
  const currentFirmId = await getCurrentFirmId();
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  const manifest = JSON.parse((await manifestFile!.async('string')) as string) as { firm_id?: string };

  if (manifest.firm_id && manifest.firm_id !== currentFirmId) {
    throw new Error('هذه النسخة الاحتياطية تخص مكتباً آخر ولا يمكن استعادتها هنا.');
  }

  const restored: string[] = [];

  if (preview.settings) {
    const { error } = await supabase
      .from('firms')
      .update({
        reminders_enabled: preview.settings.reminders_enabled,
        whatsapp_reports_enabled: preview.settings.whatsapp_reports_enabled,
        sms_reports_enabled: preview.settings.sms_reports_enabled,
        hide_financials_from_trainees: preview.settings.hide_financials_from_trainees
      })
      .eq('id', currentFirmId);
    throwIfSupabaseError(error);
    restored.push('settings');
  }

  const dataRestored = await restoreFirmBackupData(zip);
  restored.push(...dataRestored);

  if (restored.length <= 1 && !dataRestored.length) {
    throw new Error('لم يُعثر على بيانات قابلة للاستعادة في هذا الملف.');
  }

  await registerFirmBackup(
    file.size,
    restored.length,
    restored.map((item) => item.split(' ')[0] ?? item),
    `استعادة — ${preview.firmName ?? 'مكتب'}`
  );
  return { restored };
}
