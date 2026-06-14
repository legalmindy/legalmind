import { useEffect, useState } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { enrollMfa, getMfaFactors, unenrollMfa, verifyMfaEnrollment } from '../lib/auth';

export function MfaSettings() {
  const [factors, setFactors] = useState<Awaited<ReturnType<typeof getMfaFactors>>>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | undefined>();
  const [factorId, setFactorId] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void getMfaFactors().then(setFactors);
  }, []);

  const startEnroll = async () => {
    setLoading(true);
    setMessage('');
    const result = await enrollMfa();
    setLoading(false);
    if (result.error) { setMessage(result.error); return; }
    setQrCode(result.qrCode);
    setFactorId(result.factorId);
    setEnrolling(true);
  };

  const confirmEnroll = async () => {
    if (!factorId || code.length !== 6) return;
    setLoading(true);
    const result = await verifyMfaEnrollment(factorId, code);
    setLoading(false);
    if (!result.success) { setMessage(result.error ?? 'فشل التحقق'); return; }
    setEnrolling(false);
    setQrCode(undefined);
    setCode('');
    setMessage('تم تفعيل التحقق بخطوتين بنجاح.');
    void getMfaFactors().then(setFactors);
  };

  const disableMfa = async (id: string) => {
    setLoading(true);
    const result = await unenrollMfa(id);
    setLoading(false);
    if (!result.success) { setMessage(result.error ?? 'فشل الإلغاء'); return; }
    setMessage('تم إلغاء التحقق بخطوتين.');
    void getMfaFactors().then(setFactors);
  };

  const hasMfa = factors.some((f) => f.status === 'verified');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-indigo-700" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-900">التحقق بخطوتين (2FA)</h3>
      </div>

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
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="رمز QR للمصادقة الثنائية" className="w-48 h-48" />
            </div>
          )}
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
        </div>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={() => void startEnroll()}
          className="bg-indigo-900 text-white px-4 py-2.5 rounded-xl text-xs font-bold hover:bg-indigo-800 disabled:opacity-50 flex items-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          تفعيل التحقق بخطوتين
        </button>
      )}

      {message && <p className="text-xs font-bold text-slate-600" role="status">{message}</p>}
    </div>
  );
}
