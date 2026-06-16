import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { getPlanLabel } from '../constants/subscription';
import {
  useAdminPendingSubscriptionRequests,
  useSubscriptionReviewMutations
} from '../hooks/useSubscription';
import { getSubscriptionReceiptSignedUrl } from '../lib/subscription';

interface AdminSubscriptionPageProps {
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function AdminSubscriptionPage({ onNotify }: AdminSubscriptionPageProps) {
  const { data: requests = [], isLoading, isError, refetch } = useAdminPendingSubscriptionRequests(true);
  const review = useSubscriptionReviewMutations();
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

  const handleReview = async (requestId: string, action: 'approve' | 'reject') => {
    try {
      await review.mutateAsync({ requestId, action, adminNotes: notes[requestId] });
      onNotify(action === 'approve' ? 'تمت الموافقة وتفعيل الاشتراك.' : 'تم رفض الطلب.', action === 'approve' ? 'success' : 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشلت العملية.', 'error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2">
        <h1 className="text-2xl font-black text-slate-900">مراجعة طلبات الاشتراك</h1>
        <p className="text-xs text-slate-500">لوحة مشغّل المنصة — الموافقة على تحويلات بنك الكريمي.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : isError ? (
          <p className="p-8 text-center text-rose-600 text-sm">
            تعذر تحميل الطلبات. تأكد من تطبيق migration 029 وإضافتك في جدول platform_operators.
          </p>
        ) : requests.length === 0 ? (
          <p className="p-8 text-center text-slate-400 text-sm">لا توجد طلبات قيد المراجعة.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((req) => (
              <div key={req.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-black text-slate-900">{req.firmName ?? 'مكتب'}</p>
                    <p className="text-xs text-slate-500">
                      {getPlanLabel(req.plan)} — {req.amountYer.toLocaleString('ar-YE')} ر.ي — رقم الحوالة:{' '}
                      <span className="font-mono font-bold text-slate-700">{req.transferReference}</span>
                    </p>
                    <p className="text-[10px] text-slate-400">{new Date(req.createdAt).toLocaleString('ar-YE')}</p>
                  </div>
                  <button
                    type="button"
                    disabled={openingReceipt === req.receiptPath}
                    onClick={() => void openReceipt(req.receiptPath)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {openingReceipt === req.receiptPath ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    عرض الإشعار
                  </button>
                </div>
                <textarea
                  value={notes[req.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [req.id]: e.target.value }))}
                  placeholder="ملاحظات للمكتب (اختياري)"
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-right resize-none"
                />
                <div className="flex gap-2 justify-start">
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => void handleReview(req.id, 'reject')}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 border border-rose-100 hover:bg-rose-100 disabled:opacity-50"
                  >
                    رفض
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => void handleReview(req.id, 'approve')}
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
