import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import type { FirmRole, PermissionKey } from '../types/app';

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'cases.view': 'عرض القضايا',
  'cases.create': 'إنشاء قضايا',
  'cases.edit': 'تعديل القضايا',
  'cases.delete': 'حذف القضايا',
  'clients.view': 'عرض العملاء',
  'clients.create': 'إضافة عملاء',
  'clients.edit': 'تعديل العملاء',
  'clients.delete': 'حذف العملاء',
  'documents.upload': 'رفع مستندات',
  'documents.download': 'تحميل مستندات',
  'documents.delete': 'حذف مستندات',
  'financials.view': 'عرض المالية',
  'financials.add_payments': 'إضافة دفعات',
  'financials.print_receipts': 'طباعة سندات',
  'sessions.view': 'عرض الجلسات',
  'sessions.create': 'إضافة جلسات',
  'sessions.edit': 'تعديل الجلسات',
  'users.invite': 'دعوة موظفين',
  'users.manage': 'إدارة الموظفين',
  'users.permissions': 'إدارة الصلاحيات',
  'subscriptions.view': 'عرض الاشتراك',
  'subscriptions.manage': 'إدارة الاشتراك',
  'settings.view': 'عرض الإعدادات',
  'settings.edit': 'تعديل الإعدادات'
};

const LEGACY_ROLE_PERMISSIONS: Record<string, Partial<Record<PermissionKey, boolean>>> = {
  super_admin: Object.fromEntries(Object.keys(PERMISSION_LABELS).map((k) => [k, true])) as Record<
    PermissionKey,
    boolean
  >,
  admin: Object.fromEntries(Object.keys(PERMISSION_LABELS).map((k) => [k, true])) as Record<PermissionKey, boolean>,
  firm_manager: Object.fromEntries(Object.keys(PERMISSION_LABELS).map((k) => [k, true])) as Record<
    PermissionKey,
    boolean
  >,
  lawyer: {
    'cases.view': true,
    'cases.create': true,
    'cases.edit': true,
    'clients.view': true,
    'clients.create': true,
    'clients.edit': true,
    'documents.upload': true,
    'documents.download': true,
    'financials.view': true,
    'sessions.view': true,
    'sessions.create': true,
    'sessions.edit': true
  },
  assistant: {
    'cases.view': true,
    'clients.view': true,
    'clients.create': true,
    'clients.edit': true,
    'documents.upload': true,
    'documents.download': true,
    'financials.view': true,
    'financials.print_receipts': true,
    'sessions.view': true,
    'sessions.create': true,
    'sessions.edit': true
  }
};

let cachedPermissions: Record<string, boolean> | null = null;

export async function fetchMyPermissions(): Promise<Record<string, boolean>> {
  if (cachedPermissions) return cachedPermissions;

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return {};

  const { data: employee } = await supabase
    .from('employees')
    .select('role, firm_role_id, firm_roles(permissions)')
    .eq('auth_uid', session.session.user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!employee) return {};

  const rolePerms =
    (employee as { firm_roles?: { permissions?: Record<string, boolean> } | null }).firm_roles?.permissions ??
    LEGACY_ROLE_PERMISSIONS[String((employee as { role?: string }).role)] ??
    {};

  cachedPermissions = rolePerms;
  return rolePerms;
}

export function hasPermission(
  permissions: Record<string, boolean> | undefined,
  key: PermissionKey,
  fallbackRole?: string
): boolean {
  if (permissions && key in permissions) return Boolean(permissions[key]);
  if (fallbackRole && LEGACY_ROLE_PERMISSIONS[fallbackRole]?.[key]) return true;
  return false;
}

export function clearPermissionsCache(): void {
  cachedPermissions = null;
}

export async function fetchFirmRoles(): Promise<FirmRole[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('firm_roles')
    .select('*')
    .eq('firm_id', firmId)
    .order('name');
  throwIfSupabaseError(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: String(row.name),
    slug: String(row.slug),
    isTemplate: Boolean(row.is_template),
    permissions: (row.permissions as Record<string, boolean>) ?? {}
  }));
}
