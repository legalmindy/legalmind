import { Lock, CreditCard } from 'lucide-react';

interface SubscriptionLockScreenProps {
  expiresAt?: string | null;
  onRenew: () => void;
  onLogout: () => void;
}

export function SubscriptionLockScreen({ expiresAt, onRenew, onLogout }: SubscriptionLockScreenProps) {
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('ar-YE', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full bg-white rounded-3xl border border-slate-100 shadow-xl p-8 sm:p-10 text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center">
          <Lock className="w-8 h-8 text-amber-600" />
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-black text-slate-900">عذراً، انتهت فترة الاشتراك!</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            لقد انتهت صلاحية باقتك الحالية. يرجى تجديد الاشتراك عبر{' '}
            <span className="font-bold text-slate-800">بنك الكريمي</span> للاستمرار في استخدام خدمات
            النظام والوصول إلى ملفاتك وقضاياك.
          </p>
          {expiryLabel ? (
            <p className="text-xs text-rose-600 font-bold">تاريخ انتهاء الباقة: {expiryLabel}</p>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <button
            type="button"
            onClick={onRenew}
            className="inline-flex items-center justify-center gap-2 bg-indigo-950 hover:bg-indigo-800 text-white font-bold py-3 px-6 rounded-xl text-sm transition-colors"
          >
            <CreditCard className="w-4 h-4" />
            تجديد الاشتراك الآن
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center justify-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold py-3 px-6 rounded-xl text-sm transition-colors"
          >
            تسجيل الخروج
          </button>
        </div>
      </div>
    </div>
  );
}
