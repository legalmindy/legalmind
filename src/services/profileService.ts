import { supabase } from '../lib/supabaseClient';
import type { UserRole } from '../types/app';

export interface OfficeProfileContext {
  userId: string;
  profileId: string;
  officeId: string;
  firmId: string;
  employeeId: string | null;
  fullName: string;
  email: string;
  role: Extract<UserRole, 'admin' | 'lawyer' | 'assistant'>;
  officeName: string;
  officeCode: string;
}

interface ProfileContextRow {
  id: string;
  firm_id: string;
  employee_id: string | null;
  full_name: string;
  email: string;
  role: Extract<UserRole, 'admin' | 'lawyer' | 'assistant'>;
  firms: {
    id: string;
    name: string;
    firm_code: string;
  } | null;
}

interface RawProfileContextRow extends Omit<ProfileContextRow, 'firms'> {
  firms:
    | ProfileContextRow['firms']
    | NonNullable<ProfileContextRow['firms']>[];
}

export async function getCurrentProfileContext(): Promise<OfficeProfileContext | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, firm_id, employee_id, full_name, email, role, firms(id, name, firm_code)')
    .eq('id', authData.user.id)
    .is('deleted_at', null)
    .single();

  if (error) throw error;

  const row = data as unknown as RawProfileContextRow;
  const firm = Array.isArray(row.firms) ? row.firms[0] : row.firms;
  if (!firm) return null;

  return {
    userId: authData.user.id,
    profileId: row.id,
    officeId: row.firm_id,
    firmId: row.firm_id,
    employeeId: row.employee_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    officeName: firm.name,
    officeCode: firm.firm_code
  };
}

export async function requireAdminProfile(): Promise<OfficeProfileContext> {
  const context = await getCurrentProfileContext();
  if (!context) throw new Error('لم يتم العثور على ملف المستخدم.');
  if (context.role !== 'admin') throw new Error('هذه العملية متاحة لمدير المكتب فقط.');
  return context;
}
