import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { getPlanLabel } from '../constants/subscription';
import type { PaymentRecord, SaasPlanType } from '../types/app';
import { useAdminPendingPayments, usePaymentReviewMutations } from '../hooks/useSubscription';
import { getSubscriptionReceiptSignedUrl } from '../lib/subscription';

interface AdminSubscriptionPageProps {
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function planTypeLabel(planType?: SaasPlanType): string {
  if (!planType) return '—';
  if (planType === 'yearly') return getPlanLabel('annual');
  return getPlanLabel(planType);
}

export function AdminSubscriptionPage({ onNotify }: AdminSubscriptionPageProps) {
  const { data: payments = [], isLoading, isError, refetch } = useAdminPendingPayments(true);
  const review = usePaymentReviewMutations();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openingReceipt, setOpeningReceipt] = useState<string | null>(null);

  const openReceipt = async (path: string) => {
    setOpeningReceipt(path);
    try {
      const url = await getSubscriptionReceiptSignedUrl(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر فتح الإشعار.', 'error');
    } finally {
      setOpeningReceipt(null);
    }
  };

  const handleReview = async (payment: PaymentRecord, action: 'approve' | 'reject') => {
    try {
      await review.mutateAsync({
        paymentId: payment.id,
        action,
        rejectionReason: notes[payment.id]
      });
      onNotify(
        action === 'approve' ? 'تمت الموافقة وتفعيل الاشتراك.' : 'تم رفض الدفعة.',
        action === 'approve' ? 'success' : 'info'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشلت العملية.', 'error');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2">
        <h1 className="text-2xl font-black text-slate-900">إدارة الاشتراكات والمدفوعات</h1>
        <p className="text-xs text-slate-500">
          لوحة مشغّل المنصة — مراجعة الدفعات، تفعيل الاشتراكات، ورفض الطلبات غير المكتملة.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
          <p className="text-[10px] font-bold text-amber-700">قيد المراجعة</p>
          <p className="text-2xl font-black text-amber-900">{payments.length}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <p className="text-[10px] font-bold text-emerald-700">مدة شهرية</p>
          <p className="text-xs font-bold text-emerald-900 mt-1">30 يوم</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
          <p className="text-[10px] font-bold text-indigo-700">ربع سنوي / سنوي</p>
          <p className="text-xs font-bold text-indigo-900 mt-1">90 / 365 يوم</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : isError ? (
          <p className="p-8 text-center text-rose-600 text-sm">
            تعذر تحميل المدفوعات. تأكد من تطبيق migration 044 وإضافتك في جدول platform_operators.
          </p>
        ) : payments.length === 0 ? (
          <p className="p-8 text-center text-slate-400 text-sm">لا توجد مدفوعات قيد المراجعة.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <div key={payment.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-black text-slate-900">{payment.firmName ?? 'مكتب'}</p>
                    <p className="text-xs text-slate-500">
                      {planTypeLabel(payment.planType)} — {payment.amount.toLocaleString('ar-YE')} ر.ي
                    </p>
                    <p className="text-xs text-slate-500">
                      رقم الحوالة:{' '}
                      <span className="font-mono font-bold text-slate-700">{payment.transferReference ?? '—'}</span>
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {new Date(payment.createdAt).toLocaleString('ar-YE')} — طريقة الدفع: {payment.paymentMethod}
                    </p>
                  </div>
                  {payment.receiptPath ? (
                    <button
                      type="button"
                      disabled={openingReceipt === payment.receiptPath}
                      onClick={() => void openReceipt(payment.receiptPath!)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {openingReceipt === payment.receiptPath ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="w-3.5 h-3.5" />
                      )}
                      عرض الإشعار
                    </button>
                  ) : null}
                </div>
                <textarea
                  value={notes[payment.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [payment.id]: e.target.value }))}
                  placeholder="سبب الرفض أو ملاحظات للمكتب (اختياري)"
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-right resize-none"
                />
                <div className="flex gap-2 justify-start">
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => void handleReview(payment, 'reject')}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 border border-rose-100 hover:bg-rose-100 disabled:opacity-50"
                  >
                    رفض
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => void handleReview(payment, 'approve')}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {review.isPending ? 'جاري المعالجة...' : 'موافقة وتفعيل'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {isError ? (
          <div className="p-4 border-t border-slate-100">
            <button type="button" onClick={() => void refetch()} className="text-xs font-bold text-indigo-700 hover:underline">
              إعادة المحاولة
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
