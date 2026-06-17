import { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, ImageIcon, Loader2, XCircle } from 'lucide-react';
import { getPlanLabel } from '../constants/subscription';
import { RejectPaymentModal } from '../components/RejectPaymentModal';
import type { PaymentRecord, SaasPlanType } from '../types/app';
import { useAdminPendingPayments, usePaymentReviewMutations } from '../hooks/useSubscription';
import { getSubscriptionReceiptSignedUrl } from '../lib/subscription';

interface AdminSubscriptionPageProps {
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function planTypeLabel(planType?: SaasPlanType, planLabel?: string): string {
  if (planLabel) return planLabel;
  if (!planType) return '—';
  if (planType === 'yearly') return getPlanLabel('annual');
  return getPlanLabel(planType);
}

function ReceiptThumbnail({
  receiptPath,
  onOpen
}: {
  receiptPath?: string;
  onOpen: (path: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPreview = async () => {
    if (!receiptPath || previewUrl) return;
    setLoading(true);
    try {
      const url = await getSubscriptionReceiptSignedUrl(receiptPath);
      setPreviewUrl(url);
    } finally {
      setLoading(false);
    }
  };

  if (!receiptPath) {
    return <span className="text-slate-400 text-[11px]">—</span>;
  }

  const isPdf = receiptPath.toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onMouseEnter={() => void loadPreview()}
        onFocus={() => void loadPreview()}
        onClick={() => void onOpen(receiptPath)}
        className="group relative h-16 w-16 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center hover:border-indigo-300"
        title="عرض إشعار الدفع"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        ) : previewUrl && !isPdf ? (
          <img src={previewUrl} alt="إشعار الدفع" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="w-5 h-5 text-slate-400 group-hover:text-indigo-600" />
        )}
      </button>
      <button
        type="button"
        onClick={() => void onOpen(receiptPath)}
        className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 hover:underline"
      >
        <ExternalLink className="w-3 h-3" />
        فتح
      </button>
    </div>
  );
}

export function AdminSubscriptionPage({ onNotify }: AdminSubscriptionPageProps) {
  const { data: payments = [], isLoading, isError, refetch } = useAdminPendingPayments(true);
  const review = usePaymentReviewMutations();
  const [openingReceipt, setOpeningReceipt] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentRecord | null>(null);

  const pendingCount = useMemo(() => payments.length, [payments]);

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

  const handleApprove = async (payment: PaymentRecord) => {
    try {
      await review.mutateAsync({ paymentId: payment.id, action: 'approve' });
      onNotify('تمت الموافقة وتفعيل الاشتراك.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشلت الموافقة.', 'error');
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectTarget) return;
    await review.mutateAsync({
      paymentId: rejectTarget.id,
      action: 'reject',
      rejectionReason: reason
    });
    onNotify('تم رفض الطلب.', 'info');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2">
        <h1 className="text-2xl font-black text-slate-900">إدارة الاشتراكات والموافقات</h1>
        <p className="text-xs text-slate-500">
          لوحة سوبر أدمن — مراجعة طلبات subscription_requests، الموافقة على الدفعات، وتفعيل الاشتراكات.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
          <p className="text-[10px] font-bold text-amber-700">طلبات قيد المراجعة</p>
          <p className="text-2xl font-black text-amber-900">{pendingCount}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <p className="text-[10px] font-bold text-emerald-700">شهري</p>
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
            تعذر تحميل الطلبات. تأكد من تطبيق migrations 044 و 045 وأن دورك super_admin.
          </p>
        ) : payments.length === 0 ? (
          <p className="p-8 text-center text-slate-400 text-sm">لا توجد طلبات اشتراك قيد المراجعة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4 text-right font-bold">المكتب</th>
                  <th className="py-3 px-4 text-right font-bold">الباقة</th>
                  <th className="py-3 px-4 text-right font-bold">المبلغ</th>
                  <th className="py-3 px-4 text-right font-bold">رقم الحوالة</th>
                  <th className="py-3 px-4 text-center font-bold">إشعار الدفع</th>
                  <th className="py-3 px-4 text-right font-bold">التاريخ</th>
                  <th className="py-3 px-4 text-center font-bold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-slate-50/70">
                    <td className="py-4 px-4 font-black text-slate-900 whitespace-nowrap">
                      {payment.firmName ?? 'مكتب'}
                    </td>
                    <td className="py-4 px-4 text-slate-600 whitespace-nowrap">
                      {planTypeLabel(payment.planType, payment.planLabel)}
                    </td>
                    <td className="py-4 px-4 font-mono font-bold text-slate-800 whitespace-nowrap">
                      {payment.amount.toLocaleString('ar-YE')} ر.ي
                    </td>
                    <td className="py-4 px-4 font-mono text-slate-700 whitespace-nowrap">
                      {payment.transferReference ?? '—'}
                    </td>
                    <td className="py-4 px-4">
                      <ReceiptThumbnail
                        receiptPath={payment.receiptPath}
                        onOpen={(path) => void openReceipt(path)}
                      />
                      {openingReceipt === payment.receiptPath ? (
                        <span className="sr-only">جاري فتح الإشعار...</span>
                      ) : null}
                    </td>
                    <td className="py-4 px-4 text-slate-500 whitespace-nowrap">
                      {new Date(payment.createdAt).toLocaleString('ar-YE')}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          disabled={review.isPending}
                          onClick={() => setRejectTarget(payment)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          رفض
                        </button>
                        <button
                          type="button"
                          disabled={review.isPending}
                          onClick={() => void handleApprove(payment)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          موافقة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      <RejectPaymentModal
        open={Boolean(rejectTarget)}
        firmName={rejectTarget?.firmName}
        submitting={review.isPending}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleReject}
      />
    </div>
  );
}
