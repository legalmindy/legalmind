import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ModalFooter, ModalShell } from './Modals';

interface RejectPaymentModalProps {
  open: boolean;
  firmName?: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export function RejectPaymentModal({
  open,
  firmName,
  submitting,
  onClose,
  onConfirm
}: RejectPaymentModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  const handleConfirm = async () => {
    if (!reason.trim()) {
      setError('سبب الرفض مطلوب.');
      return;
    }
    setError('');
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل رفض الطلب.');
    }
  };

  return (
    <ModalShell
      title="رفض طلب الاشتراك"
      onClose={onClose}
      footer={
        <ModalFooter
          onClose={onClose}
          onSave={() => void handleConfirm()}
          cancelLabel="إلغاء"
          saveLabel={submitting ? 'جاري الرفض...' : 'تأكيد الرفض'}
          saving={submitting}
          disabled={submitting}
        />
      }
    >
      <div className="space-y-3 text-right text-xs">
        <p className="text-slate-600">
          رفض طلب الاشتراك للمكتب: <strong className="text-slate-900">{firmName ?? '—'}</strong>
        </p>
        <div>
          <label htmlFor="reject-reason" className="block font-bold text-slate-700 mb-1">
            سبب الرفض <span className="text-rose-600">*</span>
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="مثال: إشعار التحويل غير واضح أو المبلغ لا يطابق الباقة..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-right resize-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 outline-none"
          />
        </div>
        {error ? <p className="text-rose-600 font-bold">{error}</p> : null}
      </div>
    </ModalShell>
  );
}
