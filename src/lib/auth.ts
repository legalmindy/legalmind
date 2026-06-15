import type { AuthError, Factor, Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { Invitation, User, UserRole } from '../types/app';
import type { DbEmployee, DbInvitationPreview } from '../types/database';
import { mapEmployeeToUser } from './mappers';
import { logError } from './errorLogger';
import { isValidFirmCodeFormat, normalizeFirmCode } from './firmCode';

export interface AuthResult {
  success: boolean;
  error?: string;
  needsEmailVerification?: boolean;
  needsMfa?: boolean;
  factorId?: string;
}

export interface SignUpData {
  email: string;
  password: string;
  fullName: string;
  company: string;
  role?: UserRole;
  invitationToken?: string;
}

export interface OfficeRegistrationData {
  lawFirmName: string;
  ownerFullName: string;
  email: string;
  password: string;
  phone: string;
}

export interface LawyerRegistrationData {
  fullName: string;
  email: string;
  password: string;
  officeCode: string;
}

export interface InvitedUserRegistrationData {
  fullName: string;
  email: string;
  password: string;
  invitationToken: string;
}

export interface OfficeCodePreview {
  id: string;
  name: string;
  officeCode: string;
  firmCode: string;
}

export interface InvitationPreview extends Pick<Invitation, 'id' | 'email' | 'role' | 'status' | 'expiresAt'> {
  officeId: string;
  officeName: string;
}

function mapAuthError(error: AuthError): string {
  const raw = error.message ?? '';
  const messages: Record<string, string> = {
    invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    email_not_confirmed: 'يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.',
    user_already_registered: 'هذا البريد الإلكتروني مسجل مسبقاً.',
    weak_password: 'كلمة المرور ضعيفة. يجب أن تكون 8 أحرف على الأقل.',
    over_request_rate_limit: 'تم تجاوز عدد المحاولات. يرجى الانتظار قليلاً.',
    otp_expired: 'انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد.'
  };

  if (/database error saving new user/i.test(raw)) {
    return 'تعذر إنشاء الحساب في قاعدة البيانات. تأكد من صحة كود المكتب، وأن البريد غير مستخدم مسبقاً، ثم أعد المحاولة.';
  }

  if (/signup provisioning failed/i.test(raw)) {
    if (/firm code does not exist/i.test(raw)) {
      return 'كود المكتب غير موجود. تحقق من الكود مع مدير المكتب.';
    }
    if (/email already registered/i.test(raw)) {
      return 'هذا البريد الإلكتروني مسجل مسبقاً في النظام.';
    }
    return 'تعذر إكمال التسجيل. تحقق من البيانات وحاول مرة أخرى.';
  }

  const key = error.code ?? error.message;
  return messages[key] ?? raw ?? 'حدث خطأ غير متوقع.';
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPassword = password;

  if (!normalizedEmail || !normalizedPassword) {
    return { success: false, error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' };
  }

  console.log('[AUTH] Attempting sign in for email:', normalizedEmail);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword
  });
  
  if (error) {
    console.error('[AUTH] Sign in failed:', error.message);
    return { success: false, error: mapAuthError(error) };
  }

  console.log('[AUTH] Sign in successful, user ID:', data.user?.id);

  if (data.user && !data.user.email_confirmed_at) {
    console.warn('[AUTH] Email not confirmed for user:', data.user.id);
    return { success: false, needsEmailVerification: true, error: 'يرجى تأكيد بريدك الإلكتروني.' };
  }

  const mfaCheck = await checkMfaRequired();
  if (mfaCheck.needsMfa && mfaCheck.factorId) {
    console.log('[AUTH] MFA required for user:', data.user?.id);
    return { success: false, needsMfa: true, factorId: mfaCheck.factorId };
  }

  console.log('[AUTH] Sign in complete, no MFA required');
  return { success: true };
}

export async function signUp(data: SignUpData): Promise<AuthResult> {
  return registerOffice({
    lawFirmName: data.company,
    ownerFullName: data.fullName,
    email: data.email,
    password: data.password,
    phone: ''
  });
}

export async function registerOffice(data: OfficeRegistrationData): Promise<AuthResult> {
  const { error, data: authData } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        registration_flow: 'office',
        office_name: data.lawFirmName,
        full_name: data.ownerFullName,
        phone: data.phone,
        role: 'admin'
      },
      emailRedirectTo: `${window.location.origin}/login`
    }
  });

  if (error) return { success: false, error: mapAuthError(error) };

  if (authData.session) return { success: true };
  return { success: true, needsEmailVerification: true };
}

export async function verifyOfficeCode(officeCode: string): Promise<OfficeCodePreview | null> {
  const normalizedCode = normalizeFirmCode(officeCode);
  if (!isValidFirmCodeFormat(normalizedCode)) return null;

  const { data, error } = await supabase.rpc('get_office_by_code', { office_code_input: normalizedCode });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const firmCode = (row.firm_code ?? row.office_code) as string;
  return {
    id: row.id as string,
    name: row.name as string,
    officeCode: (row.office_code ?? firmCode) as string,
    firmCode
  };
}

export async function registerLawyer(data: LawyerRegistrationData): Promise<AuthResult> {
  const firmCode = normalizeFirmCode(data.officeCode);
  const office = await verifyOfficeCode(firmCode);
  if (!office) return { success: false, error: 'كود المكتب غير صحيح أو غير موجود. مثال صحيح: HUD-4829' };

  const { error, data: authData } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        registration_flow: 'lawyer',
        firm_code: firmCode,
        office_code: firmCode,
        full_name: data.fullName,
        role: 'lawyer'
      },
      emailRedirectTo: `${window.location.origin}/login`
    }
  });

  if (error) return { success: false, error: mapAuthError(error) };
  if (authData.session) return { success: true };
  return { success: true, needsEmailVerification: true };
}

export async function fetchInvitationPreview(token: string): Promise<InvitationPreview> {
  const { data, error } = await supabase.rpc('get_invitation_by_token', { raw_token: token });
  if (error) throw error;
  const preview = Array.isArray(data) ? data[0] : data;
  if (!preview) throw new Error('الدعوة غير موجودة أو انتهت صلاحيتها.');
  const row = preview as DbInvitationPreview & { office_name?: string };
  return {
    id: row.id,
    officeId: row.firm_id,
    officeName: row.office_name ?? row.firm_name,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at
  };
}

export async function registerInvitedUser(data: InvitedUserRegistrationData): Promise<AuthResult> {
  const preview = await fetchInvitationPreview(data.invitationToken);
  if (preview.status !== 'pending' || new Date(preview.expiresAt).getTime() <= Date.now()) {
    return { success: false, error: 'انتهت صلاحية الدعوة أو لم تعد صالحة.' };
  }
  if (preview.email.toLowerCase() !== data.email.toLowerCase()) {
    return { success: false, error: 'بريد الدعوة لا يطابق البريد المستخدم.' };
  }

  const { error, data: authData } = await supabase.auth.signUp({
    email: preview.email,
    password: data.password,
    options: {
      data: {
        registration_flow: 'invite',
        invitation_token: data.invitationToken,
        full_name: data.fullName,
        role: preview.role
      },
      emailRedirectTo: `${window.location.origin}/login`
    }
  });

  if (error) return { success: false, error: mapAuthError(error) };
  if (authData.session) return { success: true };
  return { success: true, needsEmailVerification: true };
}

export async function acceptInvitation(token: string): Promise<AuthResult> {
  const { error } = await supabase.rpc('accept_invitation_for_auth_user', { raw_token: token });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) void logError(error.message, { context: 'signOut' });
}

export async function resetPassword(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/?page=reset-password`
  });
  if (error) return { success: false, error: mapAuthError(error) };
  return { success: true };
}

export async function updatePassword(newPassword: string): Promise<AuthResult> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { success: false, error: mapAuthError(error) };
  return { success: true };
}

export async function resendVerificationEmail(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) return { success: false, error: mapAuthError(error) };
  return { success: true };
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function fetchCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return buildAppUser(user);
}

async function buildAppUser(authUser: SupabaseUser): Promise<User | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*, firms(name, plan), employees(profile_image)')
    .eq('id', authUser.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (profileError) {
    console.error('[AUTH] Profile query failed:', profileError.message);
  }

  if (profile) {
    const employeeImage = (profile.employees as { profile_image?: string | null } | null)?.profile_image;
    const profileImage = (profile.profile_image as string | null) ?? employeeImage ?? undefined;
    return {
      id: profile.id as string,
      name: (profile.full_name as string) ?? authUser.email ?? '',
      email: (profile.email as string) ?? authUser.email ?? '',
      role: profile.role as UserRole,
      plan: (profile.firms as { plan?: string } | null)?.plan ?? 'free',
      company: (profile.firms as { name?: string } | null)?.name ?? 'مكتب محاماة',
      phone: (profile.phone as string | null) ?? '',
      licenseNo: (profile.license_no as string | null) ?? '',
      image: profileImage ?? undefined
    };
  }

  const { data: contextRows, error: contextError } = await supabase.rpc('get_current_profile_context');
  if (!contextError && contextRows) {
    const ctx = (Array.isArray(contextRows) ? contextRows[0] : contextRows) as {
      profile_id: string;
      full_name: string;
      email: string;
      role: string;
      firm_name: string;
    } | undefined;
    if (ctx?.profile_id) {
      return {
        id: ctx.profile_id,
        name: ctx.full_name ?? authUser.email ?? '',
        email: ctx.email ?? authUser.email ?? '',
        role: ctx.role as UserRole,
        plan: 'free',
        company: ctx.firm_name ?? 'مكتب محاماة',
        phone: '',
        licenseNo: ''
      };
    }
  }

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('*, firms(name, plan)')
    .eq('auth_uid', authUser.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (employeeError) {
    console.error('[AUTH] Employee query failed:', employeeError.message);
  }

  if (employee) {
    const emp = employee as DbEmployee & { firms: { name: string; plan: string } | null };
    const mapped = mapEmployeeToUser(emp, emp.firms?.name ?? 'مكتب محاماة', emp.firms?.plan ?? 'free');
    return { ...mapped, id: authUser.id };
  }

  void logError('User profile missing after auth sign-in', {
    authUid: authUser.id,
    profileError: profileError?.message,
    contextError: contextError?.message,
    employeeError: employeeError?.message
  });
  return null;
}

// ─── MFA / 2FA ────────────────────────────────────────────────
async function checkMfaRequired(): Promise<{ needsMfa: boolean; factorId?: string }> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return { needsMfa: false };

  if (data.currentLevel === 'aal1' && data.nextLevel === 'aal2') {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f: Factor) => f.status === 'verified');
    if (totp) return { needsMfa: true, factorId: totp.id };
  }
  return { needsMfa: false };
}

export async function enrollMfa(): Promise<{ qrCode?: string; secret?: string; factorId?: string; error?: string }> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'LegalMind Yemen' });
  if (error) return { error: mapAuthError(error) };
  return {
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    factorId: data.id
  };
}

export async function verifyMfaEnrollment(factorId: string, code: string): Promise<AuthResult> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) return { success: false, error: mapAuthError(challenge.error) };

  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code
  });
  if (verify.error) return { success: false, error: mapAuthError(verify.error) };
  return { success: true };
}

export async function verifyMfaLogin(factorId: string, code: string): Promise<AuthResult> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) return { success: false, error: mapAuthError(challenge.error) };

  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code
  });
  if (verify.error) return { success: false, error: mapAuthError(verify.error) };
  return { success: true };
}

export async function unenrollMfa(factorId: string): Promise<AuthResult> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { success: false, error: mapAuthError(error) };
  return { success: true };
}

export async function getMfaFactors(): Promise<Factor[]> {
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.totp ?? [];
}

export function onAuthStateChange(callback: (user: User | null) => void) {
  return supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      const appUser = await buildAppUser(session.user);
      callback(appUser);
    } else {
      callback(null);
    }
  });
}
