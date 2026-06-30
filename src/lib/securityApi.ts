import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

export interface FirmBackupRow {
  id: string;
  createdAt: string;
  sizeBytes: number;
  fileCount: number;
  tablesIncluded: string[];
  status: string;
  notes?: string;
  createdByName?: string;
}

export interface FirmSecurityStats {
  backupCount: number;
  lastBackupAt?: string;
  exportCount: number;
  encryptedFilesCount: number;
  auditLogCount: number;
}

export async function fetchFirmBackups(limit = 50): Promise<FirmBackupRow[]> {
  const { data, error } = await supabase.rpc('list_firm_backups', { p_limit: limit });
  throwIfSupabaseError(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    createdAt: String(row.created_at),
    sizeBytes: Number(row.size_bytes ?? 0),
    fileCount: Number(row.file_count ?? 0),
    tablesIncluded: (row.tables_included as string[]) ?? [],
    status: String(row.status ?? 'completed'),
    notes: (row.notes as string) ?? undefined,
    createdByName: (row.created_by_name as string) ?? undefined
  }));
}

export async function registerFirmBackup(
  sizeBytes: number,
  fileCount: number,
  tablesIncluded: string[],
  notes?: string
): Promise<string> {
  const { data, error } = await supabase.rpc('register_firm_backup', {
    p_size_bytes: sizeBytes,
    p_file_count: fileCount,
    p_tables_included: tablesIncluded,
    p_notes: notes ?? null
  });
  throwIfSupabaseError(error);
  return data as string;
}

export async function registerFirmBackupStorage(
  storagePath: string,
  sizeBytes: number,
  fileCount: number,
  tablesIncluded: string[],
  notes?: string
): Promise<string> {
  const { data, error } = await supabase.rpc('register_firm_backup_storage', {
    p_storage_path: storagePath,
    p_size_bytes: sizeBytes,
    p_file_count: fileCount,
    p_tables_included: tablesIncluded,
    p_notes: notes ?? null
  });
  throwIfSupabaseError(error);
  return data as string;
}

export async function getFirmBackupSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('firm-backups').createSignedUrl(storagePath, 3600);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('تعذر إنشاء رابط تنزيل النسخة الاحتياطية');
  return data.signedUrl;
}

export async function registerFirmExport(
  exportType: string,
  exportFormat: string,
  filters: Record<string, unknown>,
  recordCount: number
): Promise<string> {
  const { data, error } = await supabase.rpc('register_firm_export', {
    p_export_type: exportType,
    p_export_format: exportFormat,
    p_filters: filters,
    p_record_count: recordCount
  });
  throwIfSupabaseError(error);
  return data as string;
}

export async function fetchFirmSecurityStats(): Promise<FirmSecurityStats> {
  const { data, error } = await supabase.rpc('get_firm_security_stats');
  throwIfSupabaseError(error);
  const row = (data as Record<string, unknown>) ?? {};
  return {
    backupCount: Number(row.backup_count ?? 0),
    lastBackupAt: row.last_backup_at ? String(row.last_backup_at) : undefined,
    exportCount: Number(row.export_count ?? 0),
    encryptedFilesCount: Number(row.encrypted_files_count ?? 0),
    auditLogCount: Number(row.audit_log_count ?? 0)
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
