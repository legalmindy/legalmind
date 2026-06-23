import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import type { FirmRole, PageId, PermissionKey } from '../types/app';

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

/** Minimum permission to access each app page */
export const PAGE_PERMISSIONS: Partial<Record<PageId, PermissionKey | PermissionKey[]>> = {
  clients: 'clients.view',
  execution: 'cases.view',
  cases: 'cases.view',
  'case-detail': 'cases.view',
  archive: 'cases.view',
  employees: ['users.manage', 'users.invite', 'users.permissions'],
  sessions: 'sessions.view',
  documents: 'documents.download',
  lawyers: 'cases.view',
  reports: 'financials.view',
  settings: 'settings.view',
  subscription: 'subscriptions.view',
  'audit-logs': 'settings.view'
};

export function canAccessPage(
  permissions: Record<string, boolean> | undefined,
  page: PageId,
  fallbackRole?: string
): boolean {
  if (page === 'audit-logs' || page === 'data-export' || page === 'backup' || page === 'trust-security') {
    return fallbackRole === 'firm_manager';
  }
  const required = PAGE_PERMISSIONS[page];
  if (!required) return true;
  const keys = Array.isArray(required) ? required : [required];
  return keys.some((key) => hasPermission(permissions, key, fallbackRole));
}

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
  },
  accountant: {
    'cases.view': true,
    'clients.view': true,
    'documents.download': true,
    'financials.view': true,
    'financials.add_payments': true,
    'financials.print_receipts': true,
    'sessions.view': true,
    'subscriptions.view': true
  }
};

let cachedPermissions: Record<string, boolean> | null = null;

export async function fetchMyPermissions(): Promise<Record<string, boolean>> {
  if (cachedPermissions) return cachedPermissions;

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return {};

  const { data, error } = await supabase.rpc('get_my_permissions');
  if (!error && data && typeof data === 'object') {
    cachedPermissions = data as Record<string, boolean>;
    return cachedPermissions;
  }

  const { data: employee } = await supabase
    .from('employees')
    .select('role, firm_role_id, individual_permissions, firm_roles(permissions, slug)')
    .eq('auth_uid', session.session.user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!employee) return {};

  const individual =
    (employee as { individual_permissions?: Record<string, boolean> | null }).individual_permissions;
  const firmRoles = (employee as { firm_roles?: { permissions?: Record<string, boolean> } | null }).firm_roles;
  const rolePerms = firmRoles?.permissions;
  const legacyRole = String((employee as { role?: string }).role ?? '');

  if (individual && Object.keys(individual).length > 0) {
    cachedPermissions = individual;
  } else if (rolePerms && Object.keys(rolePerms).length > 0) {
    cachedPermissions = rolePerms;
  } else if (LEGACY_ROLE_PERMISSIONS[legacyRole]) {
    cachedPermissions = LEGACY_ROLE_PERMISSIONS[legacyRole] as Record<string, boolean>;
  } else {
    cachedPermissions = {};
  }

  return cachedPermissions;
}

export function hasPermission(
  permissions: Record<string, boolean> | undefined,
  key: PermissionKey,
  fallbackRole?: string
): boolean {
  if (permissions && Object.keys(permissions).length > 0) {
    return Boolean(permissions[key]);
  }
  if (fallbackRole && LEGACY_ROLE_PERMISSIONS[fallbackRole]?.[key]) return true;
  return false;
}

/** Case detail for payments/receipts — not limited to office managers */
export function canAccessCaseDetail(
  permissions: Record<string, boolean> | undefined,
  fallbackRole?: string
): boolean {
  return (
    hasPermission(permissions, 'cases.view', fallbackRole) ||
    hasPermission(permissions, 'financials.view', fallbackRole) ||
    hasPermission(permissions, 'financials.add_payments', fallbackRole) ||
    hasPermission(permissions, 'financials.print_receipts', fallbackRole)
  );
}

export function clearPermissionsCache(): void {
  cachedPermissions = null;
}

export const NON_ASSIGNABLE_FIRM_ROLE_SLUGS = ['firm_owner'] as const;

export function isAssignableFirmRole(slug: string): boolean {
  return !NON_ASSIGNABLE_FIRM_ROLE_SLUGS.includes(slug as (typeof NON_ASSIGNABLE_FIRM_ROLE_SLUGS)[number]);
}

export async function fetchAssignableFirmRoles(): Promise<FirmRole[]> {
  const roles = await fetchFirmRoles();
  return roles.filter((role) => isAssignableFirmRole(role.slug));
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

export async function updateFirmRolePermissions(
  roleId: string,
  permissions: Record<string, boolean>
): Promise<void> {
  const { error } = await supabase.rpc('update_firm_role_permissions', {
    p_role_id: roleId,
    p_permissions: permissions
  });
  throwIfSupabaseError(error);
}

export async function createCustomFirmRole(
  name: string,
  slug: string,
  permissions: Record<string, boolean>
): Promise<string> {
  const { data, error } = await supabase.rpc('create_custom_firm_role', {
    p_name: name,
    p_slug: slug,
    p_permissions: permissions
  });
  throwIfSupabaseError(error);
  return String((data as { role_id?: string })?.role_id ?? '');
}

export async function fetchEmployeePermissions(employeeId: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.rpc('get_employee_permissions', { p_employee_id: employeeId });
  throwIfSupabaseError(error);
  return (data as Record<string, boolean>) ?? {};
}

export async function updateEmployeePermissions(
  employeeId: string,
  permissions: Record<string, boolean>
): Promise<void> {
  const { error } = await supabase.rpc('update_employee_permissions', {
    p_employee_id: employeeId,
    p_permissions: permissions
  });
  throwIfSupabaseError(error);
  clearPermissionsCache();
}

export async function applyFirmRoleToEmployee(employeeId: string, roleId: string): Promise<void> {
  const { error } = await supabase.rpc('apply_firm_role_to_employee', {
    p_employee_id: employeeId,
    p_role_id: roleId
  });
  throwIfSupabaseError(error);
}
