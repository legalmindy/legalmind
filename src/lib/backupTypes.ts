import type { ExportEntity } from './dataExport';

/** Tables included in full firm backup (raw JSON under data/raw/). */
export type BackupTable =
  | ExportEntity
  | 'firm_roles'
  | 'lawyers'
  | 'notifications'
  | 'timeline'
  | 'execution_requests'
  | 'subscriptions'
  | 'subscription_requests'
  | 'invitations'
  | 'case_attachments';

export const BACKUP_MANIFEST_VERSION = 3;

export const BACKUP_TABLES: BackupTable[] = [
  'firm_roles',
  'employees',
  'lawyers',
  'clients',
  'cases',
  'sessions',
  'payments',
  'receipts',
  'expenses',
  'execution_requests',
  'timeline',
  'notifications',
  'subscriptions',
  'subscription_requests',
  'invitations',
  'case_attachments',
  'documents'
];

export const BACKUP_TABLE_LABELS: Record<BackupTable, string> = {
  clients: 'العملاء',
  cases: 'القضايا',
  sessions: 'الجلسات',
  payments: 'المدفوعات',
  receipts: 'سندات القبض',
  expenses: 'المصروفات',
  employees: 'المستخدمين',
  documents: 'الملفات',
  firm_roles: 'الأدوار والصلاحيات',
  lawyers: 'المحامون',
  notifications: 'الإشعارات',
  timeline: 'سجل النشاط',
  execution_requests: 'طلبات التنفيذ',
  subscriptions: 'الاشتراكات',
  subscription_requests: 'طلبات الاشتراك',
  invitations: 'الدعوات',
  case_attachments: 'مرفقات القضايا'
};

export interface BackupManifestV3 {
  version: number;
  firm_id: string;
  firm_name: string;
  created_at: string;
  tables: BackupTable[];
  record_counts: Partial<Record<BackupTable, number>>;
  total_records: number;
  checksum: string;
  settings_included: boolean;
  documents_included: boolean;
}

export interface BackupIntegrityResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  recordCounts: Partial<Record<BackupTable, number>>;
  totalRecords: number;
  checksum: string;
  sizeBytes: number;
}

export interface RestoreValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  restoredCounts: Record<string, number>;
  missingForeignKeys: string[];
  duplicateIds: string[];
}

export const RESTORE_ORDER: BackupTable[] = [
  'firm_roles',
  'employees',
  'lawyers',
  'clients',
  'cases',
  'sessions',
  'payments',
  'receipts',
  'expenses',
  'execution_requests',
  'timeline',
  'notifications',
  'subscriptions',
  'subscription_requests',
  'invitations',
  'documents',
  'case_attachments'
];
