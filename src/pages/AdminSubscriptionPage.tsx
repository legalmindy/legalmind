import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, ImageIcon, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { getPlanLabel } from '../constants/subscription';
import { RejectPaymentModal } from '../components/RejectPaymentModal';
import type { PaymentRecord, SaasPlanType } from '../types/app';
import { useAuth } from '../contexts/AuthContext';
import { billingAdminQueryKey, useBillingAdmin } from '../hooks/useBillingAdmin';
import { useAdminPendingPayments, usePaymentReviewMutations, subscriptionQueryKeys } from '../hooks/useSubscription';
import { claimBillingAdminSetup, getSubscriptionReceiptSignedUrl } from '../lib/subscription';
import { formatQueryErrorMessage } from '../lib/supabaseQueryHelpers';

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
        className="group relative h-16 w-16 rounded-xl border border-[#E8D5D8] bg-[#FFF9FA] overflow-hidden flex items-center justify-center hover:border-[#7A1F2B]"
        title="عرض إشعار الدفع"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        ) : previewUrl && !isPdf ? (
          <img src={previewUrl} alt="إشعار الدفع" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="w-5 h-5 text-slate-400 group-hover:text-[#7A1F2B]" />
        )}
      </button>
      <button
        type="button"
        onClick={() => void onOpen(receiptPath)}
        className="inline-flex items-center gap-1 text-[10px] font-bold text-[#7A1F2B] hover:underline"
      >
        <ExternalLink className="w-3 h-3" />
        فتح
      </button>
    </div>
  );
}

export function AdminSubscriptionPage({ onNotify }: AdminSubscriptionPageProps) {
  const queryClient = useQueryClient();
  const { refreshUser, user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const { data: isBillingAdminDb = false, isLoading: isCheckingAccess, refetch: refetchAccess } = useBillingAdmin(isSuperAdmin);
  const isBillingAdmin = isSuperAdmin && isBillingAdminDb;

  useEffect(() => {
    if (isBillingAdminDb && user?.role !== 'super_admin') {
      void refreshUser();
    }
  }, [isBillingAdminDb, refreshUser, user?.role]);
  const { data: payments = [], isLoading: isLoadingPayments, isError, error, refetch } = useAdminPendingPayments(isBillingAdmin);
  const claimAdmin = useMutation({
    mutationFn: claimBillingAdminSetup,
    onSuccess: async () => {
      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: billingAdminQueryKey });
      await queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.adminPayments });
      await refetchAccess();
      onNotify('تم تفعيل صلاحيات سوبر أدمن.', 'success');
      await refetch();
    },
    onError: (err) => {
      onNotify(formatQueryErrorMessage(err, 'تعذر تفعيل الصلاحيات.'), 'error');
    }
  });

  const review = usePaymentReviewMutations();
  const [openingReceipt, setOpeningReceipt] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentRecord | null>(null);

  const pendingCount = useMemo(() => payments.length, [payments]);
  const errorMessage = formatQueryErrorMessage(error, 'تعذر تحميل الطلبات. تأكد من تطبيق migration 057 في Supabase.');

  const openReceipt = async (path: string) => {
    setOpeningReceipt(path);
    try {
      const url = await getSubscriptionReceiptSignedUrl(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      onNotify(formatQueryErrorMessage(err, 'تعذر فتح الإشعار.'), 'error');
    } finally {
      setOpeningReceipt(null);
    }
  };

  const handleApprove = async (payment: PaymentRecord) => {
    try {
      await review.mutateAsync({
        paymentId: payment.requestId ?? payment.id,
        action: 'approve',
        requestId: payment.requestId ?? payment.id
      });
      onNotify('تمت الموافقة وتفعيل الاشتراك.', 'success');
    } catch (err) {
      onNotify(formatQueryErrorMessage(err, 'فشلت الموافقة.'), 'error');
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectTarget) return;
    await review.mutateAsync({
      paymentId: rejectTarget.requestId ?? rejectTarget.id,
      action: 'reject',
      rejectionReason: reason,
      requestId: rejectTarget.requestId ?? rejectTarget.id
    });
    onNotify('تم رفض الطلب.', 'info');
  };

  if (isCheckingAccess) {
    return (
      <div className="flex justify-center py-24 text-[#7A1F2B]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 mt-10 text-right">
        <div className="bg-white rounded-2xl border border-[#E8D5D8] shadow-sm overflow-hidden">
          <div className="bg-[#7A1F2B] px-6 py-5 text-white">
            <h1 className="text-xl font-black">قبول الاشتراكات — سوبر أدمن</h1>
            <p className="text-xs text-white/80 mt-1">هذه الصفحة مخصصة لمسؤول منصة LegalMind فقط.</p>
          </div>
          <div className="p-8 space-y-5 text-center">
            <p className="text-sm text-slate-600 leading-relaxed">
              ليس لديك صلاحية الوصول إلى هذه الصفحة. تواصل مع مسؤول المنصة إذا كنت بحاجة للمساعدة.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isBillingAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 mt-10 text-right">
        <div className="bg-white rounded-2xl border border-[#E8D5D8] shadow-sm overflow-hidden">
          <div className="bg-[#7A1F2B] px-6 py-5 text-white">
            <h1 className="text-xl font-black">قبول الاشتراكات — سوبر أدمن</h1>
            <p className="text-xs text-white/80 mt-1">هذه الصفحة مخصصة لمسؤول منصة LegalMind فقط.</p>
          </div>
          <div className="p-8 space-y-5 text-center">
            <p className="text-sm text-slate-600 leading-relaxed">
              حسابك الحالي ليس مفعّلاً كسوبر أدمن. إذا كنت مسؤول المنصة، فعّل الصلاحية مرة واحدة.
            </p>
            <button
              type="button"
              disabled={claimAdmin.isPending}
              onClick={() => void claimAdmin.mutate()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white bg-[#7A1F2B] hover:bg-[#641923] disabled:opacity-50"
            >
              {claimAdmin.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              تفعيل صلاحيات سوبر أدمن
            </button>
            <p className="text-[11px] text-slate-400">
              إذا استمر الخطأ: نفّذ{' '}
              <span className="font-mono">057_super_admin_billing_page.sql</span>
              {' '}في Supabase SQL Editor.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right">
      <div className="bg-[#7A1F2B] p-6 rounded-2xl shadow-sm text-white space-y-2">
        <h1 className="text-2xl font-black">قبول الاشتراكات</h1>
        <p className="text-xs text-white/80">
          لوحة سوبر أدمن — مراجعة طلبات الاشتراك، الموافقة على الدفعات، وتفعيل الباقات.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E8D5D8] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-bold text-[#7A1F2B]">طلبات قيد المراجعة</p>
          <p className="text-2xl font-black text-slate-900">{pendingCount}</p>
        </div>
        <div className="bg-white border border-emerald-100 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-bold text-emerald-700">الباقة الشهرية</p>
          <p className="text-xs font-bold text-emerald-900 mt-1">30 يوم</p>
        </div>
        <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-bold text-amber-700">ربع سنوي / سنوي</p>
          <p className="text-xs font-bold text-amber-900 mt-1">90 / 365 يوم</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E8D5D8] shadow-sm overflow-hidden">
        {isLoadingPayments ? (
          <div className="flex justify-center py-16 text-[#7A1F2B]">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : isError ? (
          <div className="p-8 space-y-4 text-center">
            <p className="text-rose-600 text-sm font-bold">تعذر تحميل الطلبات</p>
            <p className="text-[11px] text-slate-600 max-w-lg mx-auto">{errorMessage}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-xs font-bold text-[#7A1F2B] hover:underline"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : payments.length === 0 ? (
          <p className="p-10 text-center text-slate-400 text-sm">لا توجد طلبات اشتراك قيد المراجعة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-[#FFF9FA] text-slate-500 border-b border-[#E8D5D8]">
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
              <tbody className="divide-y divide-[#F3E8EA]">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-[#FFF9FA]/80">
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
