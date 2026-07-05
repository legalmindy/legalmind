import { useEffect, useState } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { enrollMfa, getMfaFactors, unenrollMfa, verifyMfaEnrollment } from '../lib/auth';

interface MfaSettingsProps {
  requiredForOwner?: boolean;
}

export function MfaSettings({ requiredForOwner = false }: MfaSettingsProps) {
  const [factors, setFactors] = useState<Awaited<ReturnType<typeof getMfaFactors>>>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | undefined>();
  const [secret, setSecret] = useState<string | undefined>();
  const [factorId, setFactorId] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const refreshFactors = async () => {
    const next = await getMfaFactors();
    setFactors(next);
    return next;
  };

  useEffect(() => {
    void refreshFactors();
  }, []);

  const startEnroll = async () => {
    if (loading) return;
    setLoading(true);
    setMessage('');
    const result = await enrollMfa();
    setLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setQrCode(result.qrCode);
    setSecret(result.secret);
    setFactorId(result.factorId);
    setEnrolling(true);
    setCode('');
    void refreshFactors();
  };

  const cancelEnroll = async () => {
    if (factorId) {
      setLoading(true);
      await unenrollMfa(factorId);
      setLoading(false);
    }
    setEnrolling(false);
    setQrCode(undefined);
    setSecret(undefined);
    setFactorId(undefined);
    setCode('');
    setMessage('');
    void refreshFactors();
  };

  const confirmEnroll = async () => {
    if (!factorId || code.length !== 6 || loading) return;
    setLoading(true);
    setMessage('');
    const result = await verifyMfaEnrollment(factorId, code);
    setLoading(false);
    if (!result.success) {
      setMessage(result.error ?? 'فشل التحقق');
      return;
    }
    setEnrolling(false);
    setQrCode(undefined);
    setSecret(undefined);
    setFactorId(undefined);
    setCode('');
    setMessage('تم تفعيل التحقق بخطوتين بنجاح.');
    void refreshFactors();
  };

  const disableMfa = async (id: string) => {
    setLoading(true);
    const result = await unenrollMfa(id);
    setLoading(false);
    if (!result.success) {
      setMessage(result.error ?? 'فشل الإلغاء');
      return;
    }
    setMessage('تم إلغاء التحقق بخطوتين.');
    void refreshFactors();
  };

  const hasMfa = factors.some((f) => f.status === 'verified');
  const pendingFactors = factors.filter((f) => f.status === 'unverified');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-indigo-700" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-900">التحقق بخطوتين (2FA)</h3>
      </div>

      {requiredForOwner && !hasMfa ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          تفعيل التحقق بخطوتين إلزامي لمالك المكتب قبل استخدام النظام.
        </p>
      ) : null}

      {hasMfa ? (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <p className="text-xs text-emerald-800 font-bold mb-2">التحقق بخطوتين مفعّل</p>
          {factors.filter((f) => f.status === 'verified').map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={loading}
              onClick={() => void disableMfa(f.id)}
              className="text-xs text-rose-600 font-bold hover:underline"
            >
              إلغاء التفعيل
            </button>
          ))}
        </div>
      ) : enrolling ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-600 leading-relaxed">
            امسح رمز QR بتطبيق Google Authenticator أو Authy، ثم أدخل الرمز المكون من 6 أرقام.
          </p>
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="رمز QR للمصادقة الثنائية" className="w-48 h-48" />
            </div>
          )}
          {secret ? (
            <p className="text-[10px] text-slate-500 text-center break-all">
              أو أدخل المفتاح يدوياً: <span className="font-mono font-bold text-slate-700">{secret}</span>
            </p>
          ) : null}
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-center text-xl font-mono tracking-widest"
            aria-label="رمز التحقق"
          />
          <button
            type="button"
            disabled={loading || code.length !== 6}
            onClick={() => void confirmEnroll()}
            className="w-full bg-indigo-900 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            تأكيد التفعيل
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void cancelEnroll()}
            className="w-full text-xs font-bold text-slate-500 hover:text-slate-700"
          >
            إلغاء وإعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          {pendingFactors.length > 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              يوجد إعداد تحقق سابق لم يُكتمل. اضغط «تفعيل» لإعادة البدء.
            </p>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void startEnroll()}
            className="bg-indigo-900 text-white px-4 py-2.5 rounded-xl text-xs font-bold hover:bg-indigo-800 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            تفعيل التحقق بخطوتين
          </button>
        </>
      )}

      {message && <p className="text-xs font-bold text-slate-600" role="status">{message}</p>}
    </div>
  );
}
