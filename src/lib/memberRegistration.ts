import { callPublicRpc, supabase } from './supabaseClient';
import { normalizeFirmCode } from './firmCode';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

export interface RegistrationFirmRole {
  slug: string;
  name: string;
}

export interface PendingMemberRegistration {
  employeeId: string;
  fullName: string;
  email: string;
  roleSlug?: string;
  roleName?: string;
  createdAt: string;
}

export async function fetchFirmRolesForRegistration(officeCode: string): Promise<RegistrationFirmRole[]> {
  const normalized = normalizeFirmCode(officeCode);
  if (!normalized) return [];

  const { data, error } = await callPublicRpc('get_firm_roles_for_registration', {
    office_code_input: normalized
  });
  throwIfSupabaseError(error);

  return (data ?? []).map((row: { slug: string; name: string }) => ({
    slug: String(row.slug),
    name: String(row.name)
  }));
}

export async function fetchPendingMemberRegistrations(): Promise<PendingMemberRegistration[]> {
  const { data, error } = await supabase.rpc('list_pending_member_registrations');
  throwIfSupabaseError(error);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    employeeId: String(row.employee_id),
    fullName: String(row.full_name),
    email: String(row.email),
    roleSlug: row.role_slug ? String(row.role_slug) : undefined,
    roleName: row.role_name ? String(row.role_name) : undefined,
    createdAt: String(row.created_at)
  }));
}

export async function approveMemberRegistration(employeeId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_member_registration', { p_employee_id: employeeId });
  throwIfSupabaseError(error);
}

export async function rejectMemberRegistration(employeeId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_member_registration', { p_employee_id: employeeId });
  throwIfSupabaseError(error);
}

export async function getEmployeeAccessStatus(authUserId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('status, deleted_at')
    .eq('auth_uid', authUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  if (!data) return null;
  if (data.deleted_at != null) return 'disabled';
  return data.status ?? null;
}

export function employeeStatusMessage(status: string | null): string | null {
  if (status === 'pending_approval') {
    return 'حسابك بانتظار موافقة مالك المكتب. لا يمكنك الدخول حتى يتم التفعيل.';
  }
  if (status === 'suspended') {
    return 'تم تعليق حسابك. تواصل مع مدير المكتب.';
  }
  if (status === 'disabled') {
    return 'تم رفض طلب انضمامك أو تعطيل حسابك. تواصل مع مدير المكتب إذا كان ذلك خطأ.';
  }
  return null;
}
