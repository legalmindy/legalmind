import { AlertTriangle, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { getPlanLabel } from '../constants/subscription';
import type { FirmSubscription, PageId } from '../types/app';

interface SubscriptionStatusBannerProps {
  subscription: FirmSubscription | undefined;
  onNavigate: (page: PageId) => void;
}

export function SubscriptionStatusBanner({ subscription, onNavigate }: SubscriptionStatusBannerProps) {
  if (!subscription) return null;

  const expiresLabel = subscription.expiresAt?.split('T')[0] ?? '—';
  const isTrial = subscription.status === 'trial';
  const isActive = subscription.isActive;

  if (isActive && !isTrial) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-100 border border-emerald-200 rounded-xl p-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-black text-emerald-900">الاشتراك نشط</p>
            <p className="text-[11px] text-emerald-700">
              {getPlanLabel(subscription.plan)} — ينتهي في {expiresLabel}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('subscription')}
          className="text-[11px] font-bold text-emerald-800 hover:text-emerald-950 underline"
        >
          إدارة الاشتراك
        </button>
      </div>
    );
  }

  if (isActive && isTrial) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="bg-amber-100 border border-amber-200 rounded-xl p-2">
            <Sparkles className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-black text-amber-900">فترة تجريبية مجانية</p>
            <p className="text-[11px] text-amber-700">تنتهي في {expiresLabel} — جدّد قبل انتهاء المدة للاستمرار.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('subscription')}
          className="text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 px-3 py-1.5 rounded-lg"
        >
          تجديد الآن
        </button>
      </div>
    );
  }

  return (
    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="bg-rose-100 border border-rose-200 rounded-xl p-2">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
        </div>
        <div>
          <p className="text-sm font-black text-rose-900">الاشتراك منتهي أو مقفل</p>
          <p className="text-[11px] text-rose-700">الوصول للموكلين والقضايا والوثائق والإشعارات محدود حتى التجديد.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onNavigate('subscription')}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg"
      >
        <Clock className="w-3.5 h-3.5" />
        تجديد الاشتراك
      </button>
    </div>
  );
}
