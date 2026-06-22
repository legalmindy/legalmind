import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Shield, Mail, Loader2, UserPlus, CheckCircle2 } from 'lucide-react';
import { AppLogo } from '../components/AppLogo';
import { isValidEmail, isStrongPassword } from '../lib/sanitize';
import { isValidYemeniPhone, normalizeYemeniPhoneForStorage } from '../utils/format';
import { isValidFirmCodeFormat, normalizeFirmCode, validateFirmCodeForRegistration } from '../lib/firmCode';
import { getCurrentProfileContext } from '../services/profileService';
import { FirmCodeCard } from '../components/FirmCodeCard';
import { fetchInvitationPreview, type AuthResult, type InvitationPreview, type InvitedUserRegistrationData, type LawyerRegistrationData, type OfficeRegistrationData, type SignUpData } from '../lib/auth';
import { fetchFirmRolesForRegistration, type RegistrationFirmRole } from '../lib/memberRegistration';
import { resolveRoleDisplayName } from '../lib/roleLabels';

interface AuthPagesProps {
  currentPage: 'login' | 'register-office' | 'register-lawyer' | 'register' | 'invite' | 'forgot' | 'accept-invite';
  onNavigate: (page: 'login' | 'register-office' | 'register-lawyer' | 'forgot') => void;
  onLogin: (email: string, password: string) => Promise<AuthResult>;
  onRegister: (data: SignUpData) => Promise<AuthResult>;
  onRegisterOffice: (data: OfficeRegistrationData) => Promise<AuthResult>;
  onRegisterLawyer: (data: LawyerRegistrationData) => Promise<AuthResult>;
  onRegisterInvitedUser: (data: InvitedUserRegistrationData) => Promise<AuthResult>;
  onForgotPassword: (email: string) => Promise<AuthResult>;
  onVerifyMfa: (factorId: string, code: string) => Promise<AuthResult>;
  onResendVerification: (email: string) => Promise<AuthResult>;
  isConfigured: boolean;
}

export function AuthPages({
  currentPage,
  onNavigate,
  onLogin,
  onRegister: _onRegister,
  onRegisterOffice,
  onRegisterLawyer,
  onRegisterInvitedUser,
  onForgotPassword,
  onVerifyMfa,
  onResendVerification,
  isConfigured
}: AuthPagesProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const [registeredFirmCode, setRegisteredFirmCode] = useState('');
  const [firmPreviewName, setFirmPreviewName] = useState('');
  const [firmCodeInput, setFirmCodeInput] = useState('');
  const [firmCodeStatus, setFirmCodeStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [firmCodeError, setFirmCodeError] = useState('');
  const [firmRoles, setFirmRoles] = useState<RegistrationFirmRole[]>([]);
  const [selectedRoleSlug, setSelectedRoleSlug] = useState('');
  const inviteToken = useMemo(() => {
    const match = window.location.pathname.match(/\/invite\/([^/?#]+)/);
    const pathToken = match?.[1] ?? '';
    return decodeURIComponent(pathToken || new URLSearchParams(window.location.search).get('token') || '');
  }, []);
  const [invitePreview, setInvitePreview] = useState<InvitationPreview | null>(null);
  const [inviteStep, setInviteStep] = useState<'credentials' | 'confirm'>('credentials');
  const [inviteCredentials, setInviteCredentials] = useState({ email: '', password: '' });
  const [inviteFullName, setInviteFullName] = useState('');

  useEffect(() => {
    if (currentPage !== 'invite') return;
    setInviteStep('credentials');
    setInvitePreview(null);
    setInviteCredentials({ email: '', password: '' });
    setInviteFullName('');
    setError('');
    setSuccess('');
  }, [currentPage, inviteToken]);

  useEffect(() => {
    if (currentPage !== 'register-lawyer') return;
    const normalized = normalizeFirmCode(firmCodeInput);
    if (!normalized) {
      setFirmCodeStatus('idle');
      setFirmPreviewName('');
      setFirmCodeError('');
      setFirmRoles([]);
      setSelectedRoleSlug('');
      return;
    }
    if (!isValidFirmCodeFormat(normalized)) {
      setFirmCodeStatus('invalid');
      setFirmPreviewName('');
      setFirmCodeError(`الصيغة غير صحيحة. الكود يجب أن يكون بشكل: ABC-1234 (القيمة الحالية: ${normalized})`);
      setFirmRoles([]);
      setSelectedRoleSlug('');
      return;
    }

    const timer = window.setTimeout(() => {
      setFirmCodeStatus('checking');
      void validateFirmCodeForRegistration(normalized)
        .then(async (result) => {
          if (result.valid) {
            setFirmCodeStatus('valid');
            setFirmPreviewName(result.firmName ?? '');
            setFirmCodeError('');
            try {
              const roles = await fetchFirmRolesForRegistration(result.normalizedCode);
              setFirmRoles(roles);
              setSelectedRoleSlug(roles[0]?.slug ?? '');
            } catch {
              setFirmRoles([]);
              setSelectedRoleSlug('');
            }
          } else {
            setFirmCodeStatus('invalid');
            setFirmPreviewName('');
            setFirmCodeError(result.error ?? 'الكود غير موجود. تأكد من نسخه بدقة من إعدادات المكتب.');
            setFirmRoles([]);
            setSelectedRoleSlug('');
          }
        })
        .catch(() => {
          setFirmCodeStatus('invalid');
          setFirmPreviewName('');
          setFirmCodeError('تعذر التحقق من الكود. تحقق من الاتصال بالإنترنت.');
          setFirmRoles([]);
          setSelectedRoleSlug('');
        });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [currentPage, firmCodeInput]);

  if (!isConfigured) {
    return (
      <div className="max-w-md mx-auto mt-24 px-4 text-center">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8">
          <h2 className="text-lg font-bold text-amber-900 mb-2">إعداد Supabase مطلوب</h2>
          <p className="text-sm text-amber-700">
            يرجى إضافة <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code> و{' '}
            <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> في ملف .env.local
          </p>
        </div>
      </div>
    );
  }

  const handleAsync = async (fn: () => Promise<AuthResult>) => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await fn();
      if (result.needsMfa && result.factorId) {
        setMfaFactorId(result.factorId);
        return;
      }
      if (result.needsEmailVerification) {
        if (currentPage === 'register-lawyer') {
          setSuccess('تم إرسال طلب الانضمام بنجاح. بعد تأكيد بريدك الإلكتروني، ينتظر حسابك موافقة مالك المكتب.');
        } else if (result.error) {
          setError(result.error);
          setSuccess('تم إنشاء الحساب. يمكنك محاولة تسجيل الدخول الآن.');
        } else {
          setSuccess('تم إرسال رابط التحقق إلى بريدك الإلكتروني. يرجى تأكيد حسابك.');
        }
        return;
      }
      if (!result.success) {
        setError(result.error ?? 'فشلت العملية. يرجى المحاولة مرة أخرى.');
        return;
      }
      if (currentPage === 'invite' && inviteStep === 'credentials') {
        return;
      }
      if (currentPage === 'login') {
        setSuccess('تم تسجيل الدخول بنجاح! جاري التحويل...');
      }
      if (currentPage === 'invite') {
        setSuccess('تم إنشاء حسابك والدخول إلى المكتب بنجاح! جاري التحويل...');
      }
    } catch (err) {
      console.error('[AuthPages] submit error:', err);
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = (data.get('email') as string)?.trim() ?? '';
    const password = (data.get('password') as string) ?? '';

    setPendingEmail(email);
    setError('');
    setSuccess('');

    if (!email) {
      setError('يرجى إدخال البريد الإلكتروني.');
      return;
    }
    if (!password) {
      setError('يرجى إدخال كلمة المرور.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('البريد الإلكتروني غير صالح.');
      return;
    }

    void handleAsync(() => onLogin(email, password));
  };

  if (mfaFactorId) {
    return (
      <div className="max-w-md mx-auto mt-20 px-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
          <div className="text-center mb-6">
            <Shield className="w-10 h-10 text-indigo-700 mx-auto mb-3" aria-hidden="true" />
            <h2 className="text-2xl font-black text-slate-900">التحقق بخطوتين (2FA)</h2>
            <p className="text-xs text-slate-500 mt-1">أدخل الرمز من تطبيق المصادقة</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const code = new FormData(e.currentTarget).get('mfa_code') as string;
              void handleAsync(() => onVerifyMfa(mfaFactorId, code));
            }}
            className="space-y-4"
          >
            <input
              name="mfa_code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-center text-2xl font-mono tracking-widest focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
              aria-label="رمز التحقق بخطوتين"
            />
            {error && <p className="text-rose-600 text-xs font-bold" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              تأكيد الرمز
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (currentPage === 'register-office' || currentPage === 'register') {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
          <div className="text-center mb-6">
            <AppLogo variant="office" size="md" className="mx-auto mb-3 shadow" />
            <h2 className="text-2xl font-black text-slate-900">تسجيل مكتب محاماة</h2>
            <p className="text-xs text-slate-500 mt-1">سيتم إنشاء مكتب جديد وتعيين المالك كمدير للنظام.</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const email = data.get('email') as string;
              const password = data.get('password') as string;
              const confirmPassword = data.get('confirmPassword') as string;
              if (!isValidEmail(email)) { setError('البريد الإلكتروني غير صالح.'); return; }
              if (password !== confirmPassword) { setError('كلمتا المرور غير متطابقتين.'); return; }
              if (!isStrongPassword(password)) {
                setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وصغير ورقم.');
                return;
              }
              const phone = normalizeYemeniPhoneForStorage((data.get('phone') as string) ?? '');
              if (!isValidYemeniPhone(phone)) {
                setError('رقم الهاتف اليمني غير صالح. أدخل 9 أرقام تبدأ بـ 77 أو 73 أو 71 أو 70 (مثال: 770123456).');
                return;
              }
              void handleAsync(async () => {
                const result = await onRegisterOffice({
                  lawFirmName: data.get('officeName') as string,
                  ownerFullName: data.get('ownerName') as string,
                  email,
                  password,
                  phone
                });
                if (result.success && !result.needsEmailVerification) {
                  const ctx = await getCurrentProfileContext();
                  if (ctx?.officeCode) setRegisteredFirmCode(ctx.officeCode);
                }
                return result;
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="office-name" className="block text-xs font-bold text-slate-700 mb-1">اسم مكتب المحاماة</label>
                <input id="office-name" name="officeName" type="text" required minLength={2} placeholder="مثال: مكتب العدالة للمحاماة" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right" />
              </div>
              <div>
                <label htmlFor="owner-name" className="block text-xs font-bold text-slate-700 mb-1">اسم المالك الكامل</label>
                <input id="owner-name" name="ownerName" type="text" required minLength={2} placeholder="مثال: أ. يحيى السنيدار" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="office-email" className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
                <input id="office-email" name="email" type="email" required autoComplete="email" placeholder="office@firm.com" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right" />
              </div>
              <div>
                <label htmlFor="office-phone" className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف</label>
                <input id="office-phone" name="phone" type="tel" required inputMode="numeric" autoComplete="tel-national" minLength={9} maxLength={20} placeholder="770123456" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="office-password" className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور</label>
                <input id="office-password" name="password" type="password" required minLength={8} autoComplete="new-password" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm" />
              </div>
              <div>
                <label htmlFor="office-confirm-password" className="block text-xs font-bold text-slate-700 mb-1">تأكيد كلمة المرور</label>
                <input id="office-confirm-password" name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm" />
              </div>
            </div>
            {error && <p className="text-rose-600 text-xs font-bold" role="alert">{error}</p>}
            {success && <p className="text-emerald-600 text-xs font-bold" role="status">{success}</p>}
            {registeredFirmCode ? (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700 text-right">كود مكتبك للمشاركة مع فريقك:</p>
                <FirmCodeCard firmCode={registeredFirmCode} variant="compact" />
              </div>
            ) : null}
            <button type="submit" disabled={loading} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              تسجيل مكتب محاماة
            </button>
            <button type="button" onClick={() => onNavigate('login')} className="w-full text-center text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors">
              لديك حساب؟ تسجيل الدخول
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (currentPage === 'register-lawyer') {
    return (
      <div className="max-w-lg mx-auto mt-12 px-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
          <div className="text-center mb-6">
            <div className="bg-amber-500 w-12 h-12 rounded-2xl flex items-center justify-center text-slate-950 mx-auto mb-3 shadow">
              <UserPlus className="w-6 h-6" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-black text-slate-900">إنشاء حساب عضو بالمكتب</h2>
            <p className="text-xs text-slate-500 mt-1">أدخل كود المكتب واختر نوع صلاحيتك — يتطلب موافقة مالك المكتب.</p>
          </div>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const email = (data.get('email') as string).trim();
              const password = data.get('password') as string;
              const confirmPassword = data.get('confirmPassword') as string;
              const firmCode = normalizeFirmCode(data.get('firmCode') as string);

              setError('');
              if (!isValidEmail(email)) { setError('البريد الإلكتروني غير صالح.'); return; }
              if (password !== confirmPassword) { setError('كلمتا المرور غير متطابقتين.'); return; }
              if (!isStrongPassword(password)) {
                setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وصغير ورقم.');
                return;
              }
              if (!isValidFirmCodeFormat(firmCode)) {
                setError('صيغة كود المكتب غير صحيحة. مثال: HUD-4829');
                return;
              }
              if (!selectedRoleSlug) {
                setError('يرجى اختيار نوع الصلاحية في المكتب.');
                return;
              }

              void handleAsync(async () => {
                const validation = await validateFirmCodeForRegistration(firmCode);
                if (!validation.valid) {
                  return { success: false, error: validation.error ?? 'كود المكتب غير صالح.' };
                }
                return onRegisterLawyer({
                  fullName: data.get('fullName') as string,
                  email,
                  password,
                  officeCode: validation.normalizedCode,
                  firmRoleSlug: selectedRoleSlug
                });
              });
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="lawyer-name" className="block text-xs font-bold text-slate-700 mb-1">الاسم الكامل</label>
              <input id="lawyer-name" name="fullName" type="text" required minLength={2} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right" />
            </div>
            <div>
              <label htmlFor="lawyer-email" className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
              <input id="lawyer-email" name="email" type="email" required autoComplete="email" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right" />
            </div>
            <div>
              <label htmlFor="firm-code" className="block text-xs font-bold text-slate-700 mb-1">كود المكتب</label>
              <input
                id="firm-code"
                name="firmCode"
                type="text"
                value={firmCodeInput}
                onChange={(e) => setFirmCodeInput(e.target.value.toUpperCase())}
                placeholder="HUD-4829"
                autoComplete="off"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-center font-mono uppercase tracking-wider"
              />
              {firmCodeStatus === 'checking' && (
                <p className="text-[11px] text-slate-500 mt-1 text-right">جاري التحقق من الكود...</p>
              )}
              {firmCodeStatus === 'valid' && firmPreviewName && (
                <p className="text-[11px] text-emerald-700 mt-1 text-right flex items-center justify-end gap-1 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  مكتب: {firmPreviewName}
                </p>
              )}
              {firmCodeStatus === 'invalid' && firmCodeInput.trim() && (
                <p className="text-[11px] text-rose-600 mt-1 text-right font-bold">
                  {firmCodeError || 'كود غير صالح أو غير موجود.'}
                </p>
              )}
            </div>
            {firmCodeStatus === 'valid' && firmRoles.length > 0 ? (
              <div>
                <label htmlFor="firm-role" className="block text-xs font-bold text-slate-700 mb-1">نوع الصلاحية في المكتب</label>
                <select
                  id="firm-role"
                  value={selectedRoleSlug}
                  onChange={(e) => setSelectedRoleSlug(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right bg-white"
                >
                  {firmRoles.map((role) => (
                    <option key={role.slug} value={role.slug}>
                      {resolveRoleDisplayName(role.name, role.slug)}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1 text-right">
                  يحدد مالك المكتب صلاحياتك وفق هذا الدور بعد الموافقة على طلبك.
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input name="password" type="password" required minLength={8} placeholder="كلمة المرور" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none text-sm" />
              <input name="confirmPassword" type="password" required minLength={8} placeholder="تأكيد كلمة المرور" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none text-sm" />
            </div>
            {error && <p className="text-rose-600 text-xs font-bold" role="alert">{error}</p>}
            {success && <p className="text-emerald-600 text-xs font-bold" role="status">{success}</p>}
            <button type="submit" disabled={loading} className="w-full bg-indigo-900 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              إنشاء حساب عضو بالمكتب
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (currentPage === 'invite') {
    const expired = invitePreview
      ? invitePreview.status !== 'pending' || new Date(invitePreview.expiresAt).getTime() <= Date.now()
      : false;
    return (
      <div className="max-w-lg mx-auto mt-12 px-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
          <div className="text-center mb-6">
            <Mail className="w-10 h-10 text-indigo-700 mx-auto mb-3" aria-hidden="true" />
            <h2 className="text-2xl font-black text-slate-900">إكمال دعوة الانضمام</h2>
            <p className="text-xs text-slate-500 mt-1">
              {inviteStep === 'credentials'
                ? 'أدخل البريد الإلكتروني وكلمة المرور المرتبطة بالدعوة.'
                : invitePreview
                  ? `دعوة للانضمام إلى ${invitePreview.officeName}`
                  : 'تأكيد بياناتك'}
            </p>
          </div>

          {!inviteToken ? (
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-right">
              <p className="text-sm font-bold text-rose-700">رابط الدعوة غير صالح.</p>
              <button type="button" onClick={() => onNavigate('login')} className="mt-4 w-full bg-slate-900 text-white font-bold py-3 rounded-xl text-sm">
                العودة لتسجيل الدخول
              </button>
            </div>
          ) : expired ? (
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-right">
              <p className="text-sm font-bold text-rose-700">هذه الدعوة منتهية أو غير صالحة.</p>
              <button type="button" onClick={() => onNavigate('login')} className="mt-4 w-full bg-slate-900 text-white font-bold py-3 rounded-xl text-sm">
                العودة لتسجيل الدخول
              </button>
            </div>
          ) : inviteStep === 'credentials' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const email = (data.get('email') as string).trim();
                const password = data.get('password') as string;
                const confirmPassword = data.get('confirmPassword') as string;

                if (!isValidEmail(email)) {
                  setError('البريد الإلكتروني غير صالح.');
                  return;
                }
                if (password !== confirmPassword) {
                  setError('كلمتا المرور غير متطابقتين.');
                  return;
                }
                if (!isStrongPassword(password)) {
                  setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وصغير ورقم.');
                  return;
                }

                void handleAsync(async () => {
                  const preview = await fetchInvitationPreview(inviteToken);
                  if (preview.status !== 'pending' || new Date(preview.expiresAt).getTime() <= Date.now()) {
                    return { success: false, error: 'انتهت صلاحية الدعوة أو لم تعد صالحة.' };
                  }
                  if (preview.email.toLowerCase() !== email.toLowerCase()) {
                    return {
                      success: false,
                      error: `يجب استخدام البريد المدعو: ${preview.email}`
                    };
                  }
                  setInvitePreview(preview);
                  setInviteCredentials({ email, password });
                  setInviteFullName(preview.fullName?.trim() ?? '');
                  setInviteStep('confirm');
                  return { success: true };
                });
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="invite-email" className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@example.com"
                  dir="ltr"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none text-sm"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="كلمة المرور"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none text-sm"
                />
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="تأكيد كلمة المرور"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none text-sm"
                />
              </div>
              {error && <p className="text-rose-600 text-xs font-bold" role="alert">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                متابعة
              </button>
            </form>
          ) : (
            <form
              key={invitePreview?.id ?? 'invite-confirm'}
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                if (!invitePreview) {
                  setError('تعذر تحميل بيانات الدعوة.');
                  return;
                }
                const fullName = inviteFullName.trim();
                if (fullName.length < 2) {
                  setError('أدخل الاسم الكامل.');
                  return;
                }
                void handleAsync(() =>
                  onRegisterInvitedUser({
                    fullName,
                    email: inviteCredentials.email,
                    password: inviteCredentials.password,
                    invitationToken: inviteToken
                  })
                );
              }}
              className="space-y-4"
            >
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-right space-y-1">
                <p className="text-[11px] text-indigo-700">
                  المكتب: <strong>{invitePreview?.officeName}</strong>
                </p>
                {inviteFullName ? (
                  <p className="text-[11px] text-indigo-700">
                    الاسم في الدعوة: <strong>{inviteFullName}</strong>
                  </p>
                ) : null}
                <p className="text-[11px] text-indigo-700 font-mono" dir="ltr">
                  {inviteCredentials.email}
                </p>
              </div>
              <div>
                <label htmlFor="invite-full-name" className="block text-xs font-bold text-slate-700 mb-1">الاسم الكامل</label>
                <input
                  id="invite-full-name"
                  name="invitedFullName"
                  type="text"
                  required
                  minLength={2}
                  value={inviteFullName}
                  onChange={(e) => setInviteFullName(e.target.value)}
                  autoComplete="name"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-right outline-none"
                  placeholder="الاسم كما سجّله مدير المكتب"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  {invitePreview?.fullName
                    ? 'يُعبَّأ تلقائياً من الدعوة — يمكنك تعديله قبل الدخول.'
                    : 'لم يُسجَّل اسم في الدعوة — أدخل اسمك أو تواصل مع مدير المكتب.'}
                </p>
              </div>
              {error && <p className="text-rose-600 text-xs font-bold" role="alert">{error}</p>}
              {success && <p className="text-emerald-600 text-xs font-bold" role="status">{success}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInviteStep('credentials');
                    setInviteFullName('');
                    setError('');
                    setSuccess('');
                  }}
                  className="flex-1 border border-slate-200 text-slate-600 font-bold py-3 rounded-xl text-sm"
                >
                  رجوع
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  الدخول إلى الحساب
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (currentPage === 'forgot') {
    return (
      <div className="max-w-md mx-auto mt-24 px-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
          <div className="text-center mb-6">
            <Mail className="w-10 h-10 text-indigo-700 mx-auto mb-3" aria-hidden="true" />
            <h2 className="text-2xl font-black text-slate-900">استعادة كلمة المرور</h2>
            <p className="text-xs text-slate-500 mt-2">سيرسل لك رابط آمن لإعادة تعيين كلمة المرور.</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const email = new FormData(e.currentTarget).get('email') as string;
              if (!isValidEmail(email)) { setError('البريد الإلكتروني غير صالح.'); return; }
              void handleAsync(() => onForgotPassword(email));
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="forgot-email" className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني المسجل</label>
              <input id="forgot-email" name="email" type="email" required autoComplete="email" placeholder="name@firm.com" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right" />
            </div>
            {error && <p className="text-rose-600 text-xs font-bold" role="alert">{error}</p>}
            {success && <p className="text-emerald-600 text-xs font-bold" role="status">{success || 'تم إرسال رابط الاستعادة إلى بريدك.'}</p>}
            <button type="submit" disabled={loading} className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              إرسال رابط الاستعادة
            </button>
            <button type="button" onClick={() => onNavigate('login')} className="w-full text-center text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors">
              العودة لتسجيل الدخول
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20 px-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
        <div className="text-center mb-6">
          <AppLogo variant="law" size="md" className="mx-auto mb-3 shadow" />
          <h2 className="text-2xl font-black text-slate-900">تسجيل الدخول للمنصة</h2>
          <p className="text-xs text-slate-500 mt-1">دخول المدراء والمحامين والمساعدين حسب الصلاحية.</p>
        </div>

        <form
          noValidate
          onSubmit={handleLoginSubmit}
          className="space-y-4"
        >
          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني المهني</label>
            <input id="login-email" name="email" type="email" autoComplete="email" placeholder="name@firm.com" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm text-right" />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="login-password" className="block text-xs font-bold text-slate-700">كلمة المرور</label>
              <button type="button" onClick={() => onNavigate('forgot')} className="text-[10px] text-indigo-700 hover:underline font-bold">
                نسيت كلمة المرور؟
              </button>
            </div>
            <input id="login-password" name="password" type="password" autoComplete="current-password" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-sm" />
          </div>
          {error && (
            <div role="alert">
              <p className="text-rose-600 text-xs font-bold">{error}</p>
              {error.includes('تأكيد') && pendingEmail && (
                <button
                  type="button"
                  onClick={() => void handleAsync(() => onResendVerification(pendingEmail))}
                  className="text-indigo-700 text-xs font-bold hover:underline mt-1"
                >
                  إعادة إرسال رابط التحقق
                </button>
              )}
            </div>
          )}
          {success && <p className="text-emerald-600 text-xs font-bold" role="status">{success}</p>}
          <button type="submit" disabled={loading} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            تسجيل الدخول الآمن
          </button>
        </form>

        <div className="border-t border-slate-100 my-6 pt-4 text-center">
          <span className="text-xs text-slate-500">ليس لديك حساب؟</span>{' '}
          <button type="button" onClick={() => onNavigate('register-office')} className="text-xs text-indigo-700 font-bold hover:underline">
            تسجيل مكتب
          </button>
          <span className="text-xs text-slate-400 mx-2">|</span>
          <button type="button" onClick={() => onNavigate('register-lawyer')} className="text-xs text-indigo-700 font-bold hover:underline">
            عضو بالمكتب
          </button>
        </div>
      </div>
    </div>
  );
}
