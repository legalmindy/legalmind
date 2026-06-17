import { useRef, useState } from 'react';
import { Building2, Upload, X } from 'lucide-react';
import { ModalFooter, ModalShell } from './Modals';
import { usePlatformBankDetails } from '../hooks/usePlatformBank';
import { defaultPlatformBankDetails } from '../lib/platformBank';
import type { SubscriptionPlan } from '../types/app';

interface SubscriptionUpgradeModalProps {
  open: boolean;
  plan: SubscriptionPlan | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { transferReference: string; receiptFile: File }) => Promise<void>;
}

export function SubscriptionUpgradeModal({
  open,
  plan,
  submitting,
  onClose,
  onSubmit
}: SubscriptionUpgradeModalProps) {
  const { data: bankDetails } = usePlatformBankDetails(open);
  const bank = bankDetails ?? defaultPlatformBankDetails();
  const [transferReference, setTransferReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open || !plan) return null;

  const resetAndClose = () => {
    setTransferReference('');
    setReceiptFile(null);
    setError('');
    onClose();
  };

  const handleSave = async () => {
    setError('');
    if (!transferReference.trim()) {
      setError('يرجى إدخال رقم العملية أو الحوالة.');
      return;
    }
    if (!receiptFile) {
      setError('يرجى رفع صورة إشعار التحويل.');
      return;
    }
    try {
      await onSubmit({ transferReference: transferReference.trim(), receiptFile });
      resetAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إرسال طلب التجديد.');
    }
  };

  return (
    <ModalShell
      title={`ترقية / تجديد — ${plan.name}`}
      onClose={resetAndClose}
      wide
      footer={
        <ModalFooter
          onClose={resetAndClose}
          onSave={() => void handleSave()}
          cancelLabel="إلغاء"
          saveLabel={submitting ? 'جاري الإرسال...' : 'إرسال طلب التفعيل'}
          saving={submitting}
          disabled={submitting}
        />
      }
    >
      <div className="space-y-4 text-xs text-right">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <p className="font-bold text-amber-900">تفاصيل الباقة</p>
          <p className="text-slate-700">{plan.name}</p>
          <p className="text-lg font-black text-slate-900">
            {plan.price} <span className="text-xs font-bold text-slate-500">ريال يمني — {plan.period}</span>
          </p>
        </div>

        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-2">
          <div className="flex items-center gap-2 font-bold text-indigo-950">
            <Building2 className="w-4 h-4" />
            التحويل عبر {bank.bankName}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
            <p><span className="text-slate-500">اسم الحساب:</span> {bank.accountName}</p>
            <p><span className="text-slate-500">رقم الحساب:</span> {bank.accountNumber}</p>
            <p className="sm:col-span-2"><span className="text-slate-500">IBAN:</span> {bank.iban}</p>
          </div>
          <p className="text-[11px] text-slate-500">{bank.note}</p>
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">رقم العملية / الحوالة</label>
          <input
            type="text"
            value={transferReference}
            onChange={(e) => setTransferReference(e.target.value)}
            placeholder="مثال: 7845123690"
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 outline-none text-right font-mono"
          />
        </div>

        <div>
          <label className="block text-slate-600 mb-1 font-bold">صورة إشعار التحويل</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700"
            >
              <Upload className="w-4 h-4" />
              {receiptFile ? 'تغيير الملف' : 'رفع الإشعار'}
            </button>
            {receiptFile ? (
              <span className="flex items-center gap-1 text-slate-600 truncate">
                {receiptFile.name}
                <button type="button" onClick={() => setReceiptFile(null)} aria-label="إزالة الملف">
                  <X className="w-3.5 h-3.5 text-rose-500" />
                </button>
              </span>
            ) : null}
          </div>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          بعد الإرسال سيُراجع طلبك من الإدارة ويُفعَّل حسابك يدوياً. ستصلك رسالة داخل النظام عند الموافقة.
        </p>

        {error ? <p className="text-rose-600 font-bold text-[11px]">{error}</p> : null}
      </div>
    </ModalShell>
  );
}
