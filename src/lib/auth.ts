import type { AuthError, Factor, Session, User as SupabaseUser } from '@supabase/supabase-js';
import { callPublicRpc, supabase } from './supabaseClient';
import type { Invitation, User, UserRole } from '../types/app';
import type { DbEmployee, DbInvitationPreview } from '../types/database';
import { mapEmployeeToUser } from './mappers';
import { logError } from './errorLogger';
import { isValidFirmCodeFormat, normalizeFirmCode, isEmailAvailableForRegistration } from './firmCode';
import { clearFirmIdCache } from './api';
import { clearPermissionsCache } from './permissions';
import { clearAppQueryCache } from './queryClient';
import { isValidYemeniPhone, normalizeYemeniPhoneForStorage } from '../utils/format';
import { employeeStatusMessage, getEmployeeAccessStatus } from './memberRegistration';

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
  firmRoleSlug: string;
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

  if (/invalid login credentials/i.test(raw)) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }

  if (/database error saving new user/i.test(raw)) {
    console.error('[AUTH] Supabase signup provisioning error:', raw);
    return 'تعذر إنشاء الحساب في قاعدة البيانات. تحقق من صحة رقم الهاتف (9 أرقام تبدأ بـ 77 أو 73 أو 71 أو 70)، وأن البريد غير مستخدم مسبقاً، ثم أعد المحاولة.';
  }

  if (/duplicate key|unique constraint|already registered/i.test(raw)) {
    return 'هذا البريد الإلكتروني مسجل مسبقاً في النظام.';
  }

  if (
    /error sending confirmation|confirmation email|smtp|email.*send|mail.*send/i.test(raw) ||
    /تأكيد.*بريد|إرسال.*تأكيد|رسالة تأكيد/i.test(raw)
  ) {
    return 'تعذّر إرسال بريد التأكيد من السيرفر. قد يكون حسابك أُنشئ — جرّب تسجيل الدخول. إن استمر الخطأ: من لوحة Supabase → Authentication → Email فعّل SMTP أو عطّل "Confirm email" مؤقتاً للاختبار.';
  }

  if (/signup provisioning failed/i.test(raw)) {
    if (/firm code does not exist/i.test(raw)) {
      return 'كود المكتب غير موجود. تحقق من الكود مع مدير المكتب.';
    }
    if (/email already registered/i.test(raw)) {
      return 'هذا البريد الإلكتروني مسجل مسبقاً في النظام.';
    }
    if (/invalid yemeni phone|phone number/i.test(raw)) {
      return 'رقم الهاتف اليمني غير صالح. أدخل 9 أرقام تبدأ بـ 77 أو 73 أو 71 أو 70 (مثال: 770123456).';
    }
    if (/check constraint|employees_phone/i.test(raw)) {
      return 'رقم الهاتف غير صالح. أدخل 9 أرقام فقط بدون مسافات أو رمز الدولة.';
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

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword
  });
  
  if (error) {
    if (import.meta.env.DEV && !/invalid login credentials|invalid_credentials/i.test(error.message ?? '')) {
      console.error('[AUTH] Sign in failed:', error.message);
    }
    return { success: false, error: mapAuthError(error) };
  }

  if (data.user && !data.user.email_confirmed_at) {
    if (import.meta.env.DEV) {
      console.warn('[AUTH] Email not confirmed for user:', data.user.id);
    }
    return { success: false, needsEmailVerification: true, error: 'يرجى تأكيد بريدك الإلكتروني.' };
  }

  const mfaCheck = await checkMfaRequired();
  if (mfaCheck.needsMfa && mfaCheck.factorId) {
    return { success: false, needsMfa: true, factorId: mfaCheck.factorId };
  }

  if (data.user) {
    const status = await getEmployeeAccessStatus(data.user.id);
    const blockMessage = employeeStatusMessage(status);
    if (blockMessage) {
      await supabase.auth.signOut();
      clearAppQueryCache();
      clearPermissionsCache();
      clearFirmIdCache();
      return { success: false, error: blockMessage };
    }
  }

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
  const normalizedEmail = data.email.trim().toLowerCase();
  const normalizedPhone = normalizeYemeniPhoneForStorage(data.phone);

  if (!isValidYemeniPhone(normalizedPhone)) {
    return {
      success: false,
      error: 'رقم الهاتف اليمني غير صالح. أدخل 9 أرقام تبدأ بـ 77 أو 73 أو 71 أو 70 (مثال: 770123456).'
    };
  }

  try {
    const emailAvailable = await isEmailAvailableForRegistration(normalizedEmail);
    if (!emailAvailable) {
      return { success: false, error: 'هذا البريد الإلكتروني مسجل مسبقاً في النظام. جرّب تسجيل الدخول أو استخدم بريداً آخر.' };
    }
  } catch (err) {
    console.warn('[AUTH] Email availability check failed:', err);
  }

  const { error, data: authData } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: data.password,
    options: {
      data: {
        registration_flow: 'office',
        office_name: data.lawFirmName.trim(),
        full_name: data.ownerFullName.trim(),
        phone: normalizedPhone,
        role: 'admin'
      },
      emailRedirectTo: `${window.location.origin}/login`
    }
  });

  if (error) {
    const raw = error.message ?? '';
    if (
      authData?.user &&
      (/confirm|confirmation|email.*send|smtp|تأكيد|إرسال/i.test(raw))
    ) {
      return {
        success: true,
        needsEmailVerification: true,
        error:
          'تم إنشاء حساب المكتب، لكن تعذّر إرسال بريد التأكيد. جرّب تسجيل الدخول مباشرة — أو راجع بريدك (مجلد Spam).'
      };
    }
    return { success: false, error: mapAuthError(error) };
  }

  if (authData.session) return { success: true };
  return { success: true, needsEmailVerification: true };
}

export async function verifyOfficeCode(officeCode: string): Promise<OfficeCodePreview | null> {
  const normalizedCode = normalizeFirmCode(officeCode);
  if (!isValidFirmCodeFormat(normalizedCode)) return null;

  const { data, error } = await callPublicRpc('get_office_by_code', { office_code_input: normalizedCode });
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

  const roleSlug = data.firmRoleSlug?.trim();
  if (!roleSlug || roleSlug === 'firm_owner') {
    return { success: false, error: 'يرجى اختيار نوع الصلاحية في المكتب.' };
  }

  const normalizedEmail = data.email.trim().toLowerCase();
  try {
    const emailAvailable = await isEmailAvailableForRegistration(normalizedEmail);
    if (!emailAvailable) {
      return { success: false, error: 'هذا البريد الإلكتروني مسجل مسبقاً في النظام. جرّب تسجيل الدخول أو استخدم بريداً آخر.' };
    }
  } catch (err) {
    console.warn('[AUTH] Email availability check failed:', err);
  }

  const { error, data: authData } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        registration_flow: 'office_member',
        firm_code: firmCode,
        office_code: firmCode,
        firm_role_slug: roleSlug,
        full_name: data.fullName,
        role: roleSlug.includes('lawyer') ? 'lawyer' : 'assistant'
      },
      emailRedirectTo: `${window.location.origin}/login`
    }
  });

  if (error) return { success: false, error: mapAuthError(error) };
  if (authData.session) {
    await supabase.auth.signOut();
  }
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
  clearFirmIdCache();
  clearPermissionsCache();
  clearAppQueryCache();
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

  const status = await getEmployeeAccessStatus(user.id);
  if (employeeStatusMessage(status)) {
    await supabase.auth.signOut();
    clearAppQueryCache();
    clearPermissionsCache();
    clearFirmIdCache();
    return null;
  }

  return buildAppUser(user);
}

export async function fetchCurrentUserWithRepair(): Promise<User | null> {
  let appUser = await fetchCurrentUser();
  if (appUser) return appUser;

  const repaired = await ensureAuthProfileReady();
  if (!repaired.ok) return null;

  return fetchCurrentUser();
}

export async function fetchCurrentUserWithRepairDetails(): Promise<{
  user: User | null;
  repair: AuthRepairResult;
}> {
  let user = await fetchCurrentUser();
  if (user) return { user, repair: { ok: true, action: 'existing' } };

  user = await loadUserFromProfileContext();
  if (user) return { user, repair: { ok: true, action: 'context_rpc' } };

  const repair = await ensureAuthProfileReady();
  if (repair.ok) {
    user = await fetchCurrentUser();
    if (!user) {
      user = await loadUserFromProfileContext();
    }
  }
  return { user, repair };
}

export interface AuthRepairResult {
  ok: boolean;
  error?: string;
  action?: string;
}

async function repairAuthProfileIfNeeded(): Promise<AuthRepairResult> {
  const { data, error } = await supabase.rpc('repair_current_user_profile');
  if (error) {
    if (/repair_current_user_profile|42883|does not exist/i.test(error.message)) {
      return {
        ok: false,
        error: 'نظام ربط الحساب غير مفعّل. طبّق migrations 054–056 في Supabase SQL Editor.'
      };
    }
    if (/email_linked_to_another_account/i.test(error.message)) {
      return {
        ok: false,
        error: 'هذا البريد مربوط بحساب Auth آخر. استخدم نفس البريد الذي سجّلت به المكتب، أو تواصل مع الدعم.'
      };
    }
    if (/profile_repair_failed/i.test(error.message)) {
      return {
        ok: false,
        error: 'تعذر ربط حسابك بمكتب موجود. تواصل مع الدعم مع ذكر بريدك الإلكتروني.'
      };
    }
    if (/duplicate key|unique constraint|check_violation/i.test(error.message)) {
      const retryUser = await loadUserFromProfileContext();
      if (retryUser) {
        return { ok: true, action: 'linked_after_conflict' };
      }
    }
    return { ok: false, error: error.message };
  }
  const payload = data as { ok?: boolean; action?: string } | null;
  return {
    ok: Boolean(payload?.ok),
    action: payload?.action,
    error: payload?.ok ? undefined : 'تعذر إكمال ربط الحساب.'
  };
}

/** Attempts to create/link profile + employee for the current auth session. */
export async function ensureAuthProfileReady(): Promise<AuthRepairResult> {
  return repairAuthProfileIfNeeded();
}

async function loadEmployeeForAuthUser(
  authUserId: string,
  options?: { employeeId?: string | null; email?: string | null }
): Promise<{
  role?: UserRole;
  profileImage?: string | null;
} | null> {
  const selectEmployee = async (column: 'auth_uid' | 'id' | 'email', value: string) => {
    const { data, error } = await supabase
      .from('employees')
      .select('role, profile_image')
      .eq(column, value)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[AUTH] Employee role query failed:', error.message);
      return null;
    }
    return data;
  };

  let data = await selectEmployee('auth_uid', authUserId);

  if (!data && options?.employeeId) {
    data = await selectEmployee('id', options.employeeId);
  }

  if (!data && options?.email) {
    data = await selectEmployee('email', options.email.trim().toLowerCase());
  }

  if (!data) return null;
  return {
    role: data.role as UserRole,
    profileImage: data.profile_image as string | null
  };
}

/** Prefer employees.role; map legacy profile/employee values to app roles. */
function resolveAppUserRole(employeeRole?: UserRole | null, profileRole?: string | null): UserRole {
  if (employeeRole) {
    if (employeeRole === 'admin') return 'firm_manager';
    return employeeRole;
  }
  if (profileRole === 'admin') return 'firm_manager';
  if (profileRole === 'assistant') return 'assistant';
  if (profileRole === 'lawyer') return 'lawyer';
  return 'firm_manager';
}

async function loadUserFromProfileContext(): Promise<User | null> {
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: contextRows, error: contextError } = await supabase.rpc('get_current_profile_context');
  if (contextError || !contextRows) return null;

  const ctx = (Array.isArray(contextRows) ? contextRows[0] : contextRows) as {
    profile_id: string;
    full_name: string;
    email: string;
    role: string;
    firm_name: string;
  } | undefined;

  if (!ctx?.profile_id) return null;

  const employee = await loadEmployeeForAuthUser(authUser.id, {
    email: ctx.email ?? authUser.email ?? null
  });

  return {
    id: ctx.profile_id,
    name: ctx.full_name ?? authUser.email ?? '',
    email: ctx.email ?? authUser.email ?? '',
    role: resolveAppUserRole(employee?.role, ctx.role),
    plan: 'free',
    company: ctx.firm_name ?? 'مكتب محاماة',
    phone: '',
    licenseNo: ''
  };
}

async function mapProfileRowToUser(
  authUser: SupabaseUser,
  profile: Record<string, unknown>
): Promise<User> {
  const employee = await loadEmployeeForAuthUser(authUser.id, {
    employeeId: profile.employee_id as string | null,
    email: (profile.email as string | null) ?? authUser.email ?? null
  });
  const profileImage = (profile.profile_image as string | null) ?? employee?.profileImage ?? undefined;
  const profileRole = profile.role as string | null;
  return {
    id: profile.id as string,
    name: (profile.full_name as string) ?? authUser.email ?? '',
    email: (profile.email as string) ?? authUser.email ?? '',
    role: resolveAppUserRole(employee?.role, profileRole),
    plan: (profile.firms as { plan?: string } | null)?.plan ?? 'free',
    company: (profile.firms as { name?: string } | null)?.name ?? 'مكتب محاماة',
    phone: (profile.phone as string | null) ?? '',
    licenseNo: (profile.license_no as string | null) ?? '',
    image: profileImage ?? undefined
  };
}

async function buildAppUser(authUser: SupabaseUser): Promise<User | null> {
  const loadProfile = async () => {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*, firms!firm_id(name, plan)')
      .eq('id', authUser.id)
      .is('deleted_at', null)
      .maybeSingle();
    return { profile, profileError };
  };

  let { profile, profileError } = await loadProfile();

  if (profileError) {
    console.error('[AUTH] Profile query failed:', profileError.message);
  }

  if (!profile) {
    const contextUser = await loadUserFromProfileContext();
    if (contextUser) return contextUser;

    const repaired = await repairAuthProfileIfNeeded();
    if (repaired.ok) {
      ({ profile, profileError } = await loadProfile());
    }
  }

  if (profile) {
    return mapProfileRowToUser(authUser, profile as Record<string, unknown>);
  }

  const contextUser = await loadUserFromProfileContext();
  if (contextUser) return contextUser;

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('*, firms!firm_id(name, plan)')
    .eq('auth_uid', authUser.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (employeeError) {
    console.error('[AUTH] Employee query failed:', employeeError.message);
  }

  if (employee) {
    const emp = employee as DbEmployee & { firms: { name: string; plan: string } | null };
    const mapped = mapEmployeeToUser(emp, emp.firms?.name ?? 'مكتب محاماة', emp.firms?.plan ?? 'free');
    return {
      ...mapped,
      id: authUser.id,
      role: resolveAppUserRole(mapped.role, null)
    };
  }

  await repairAuthProfileIfNeeded();
  ({ profile, profileError } = await loadProfile());
  if (profile) {
    return mapProfileRowToUser(authUser, profile as Record<string, unknown>);
  }

  const { data: employeeRetry } = await supabase
    .from('employees')
    .select('*, firms!firm_id(name, plan)')
    .eq('auth_uid', authUser.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (employeeRetry) {
    const emp = employeeRetry as DbEmployee & { firms: { name: string; plan: string } | null };
    const mapped = mapEmployeeToUser(emp, emp.firms?.name ?? 'مكتب محاماة', emp.firms?.plan ?? 'free');
    return {
      ...mapped,
      id: authUser.id,
      role: resolveAppUserRole(mapped.role, null)
    };
  }

  void logError('User profile missing after auth sign-in', {
    authUid: authUser.id,
    profileError: profileError?.message,
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
      let appUser = await buildAppUser(session.user);
      if (!appUser) {
        await ensureAuthProfileReady();
        appUser = await buildAppUser(session.user);
      }
      callback(appUser);
    } else {
      callback(null);
    }
  });
}
