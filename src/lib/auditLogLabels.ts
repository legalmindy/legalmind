export const ACTIVITY_TABLE_LABELS: Record<string, string> = {
  clients: 'عملاء',
  cases: 'قضايا',
  documents: 'مستندات',
  sessions: 'جلسات',
  case_payments: 'دفعات',
  case_expenses: 'مصاريف قضايا',
  receipt_vouchers: 'سندات قبض',
  office_expenses: 'مصروفات',
  employees: 'موظفون',
  invitations: 'دعوات',
  case_attachments: 'مرفقات'
};

export const ACTIVITY_OPERATION_LABELS: Record<string, string> = {
  INSERT: 'إضافة',
  UPDATE: 'تعديل',
  DELETE: 'حذف'
};

export const ACTIVITY_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'كل النشاط' },
  { value: 'clients', label: 'العملاء' },
  { value: 'cases', label: 'القضايا' },
  { value: 'documents', label: 'المستندات' },
  { value: 'sessions', label: 'الجلسات' },
  { value: 'case_payments', label: 'الدفعات' },
  { value: 'case_expenses', label: 'مصاريف القضايا' },
  { value: 'receipt_vouchers', label: 'سندات القبض' },
  { value: 'office_expenses', label: 'المصروفات' },
  { value: 'employees', label: 'الموظفون' },
  { value: 'invitations', label: 'الدعوات' }
];

export function formatActivityOperation(operation: string): string {
  return ACTIVITY_OPERATION_LABELS[operation] ?? operation;
}

export function formatActivityTable(tableName: string): string {
  return ACTIVITY_TABLE_LABELS[tableName] ?? tableName;
}

export function formatActivityDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-YE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
