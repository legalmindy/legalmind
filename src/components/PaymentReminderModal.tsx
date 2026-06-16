import { useState } from 'react';
import { Copy, MessageCircle, X, AlertCircle } from 'lucide-react';
import type { CaseRecord, Client } from '../types/app';
import { buildPaymentReminderMessage, openClientReportChannel, logClientReport } from '../lib/clientReports';

interface PaymentReminderModalProps {
  open: boolean;
  caseRecord: CaseRecord | null;
  client: Client | null;
  officeName: string;
  whatsappEnabled: boolean;
  onClose: () => void;
  onSent: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function formatYer(v: number) {
  return v.toLocaleString('ar-YE') + ' ر.ي';
}

export function PaymentReminderModal({
  open,
  caseRecord,
  client,
  officeName,
  whatsappEnabled,
  onClose,
  onSent
}: PaymentReminderModalProps) {
  const [customMessage, setCustomMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!open || !caseRecord) return null;

  const defaultMessage = buildPaymentReminderMessage({
    clientName: client?.name ?? caseRecord.clientName,
    officeName,
    caseTitle: caseRecord.title,
    remainingAmount: caseRecord.remaining_amount,
    caseNo: caseRecord.caseNo
  });

  const body = customMessage.trim() || defaultMessage;
  const phone = client?.phone ?? '';
  const hasPhone = Boolean(phone.trim());

  const handleSend = async () => {
    if (!hasPhone) {
      onSent('لا يوجد رقم هاتف مسجل لهذا العميل.', 'error');
      return;
    }
    setSending(true);
    try {
      openClientReportChannel(phone, 'whatsapp', body);
      if (client?.id) {
        await logClientReport({ clientId: client.id, channel: 'whatsapp', messageBody: body });
      }
      onSent('تم فتح واتساب لإرسال تذكير الدفع.', 'success');
      setCustomMessage('');
      onClose();
    } catch (err) {
      onSent(err instanceof Error ? err.message : 'فشل تسجيل الرسالة.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      onSent('تم نسخ الرسالة.', 'success');
    } catch {
      onSent('تعذر النسخ التلقائي — انسخ يدوياً.', 'info');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xl w-full max-w-lg p-6 space-y-4 text-right">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
          <div>
            <h3 className="text-lg font-black text-slate-900">تذكير بالمبلغ المستحق</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">إرسال واتساب للعميل بتفاصيل الأتعاب المتبقية</p>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-2 text-xs">
          <div className="flex items-center gap-2 text-amber-700 font-bold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>تنبيه الموقف المالي</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-700">
            <div><span className="text-slate-400">القضية: </span><span className="font-bold">{caseRecord.title}</span></div>
            <div><span className="text-slate-400">رقم القضية: </span><span className="font-mono font-bold">{caseRecord.caseNo}</span></div>
            <div><span className="text-slate-400">العميل: </span><span className="font-bold">{client?.name ?? caseRecord.clientName}</span></div>
            <div><span className="text-slate-400">الهاتف: </span>
              {hasPhone
                ? <span className="font-mono font-bold text-emerald-700">{phone}</span>
                : <span className="text-rose-500 font-bold">غير مسجل</span>}
            </div>
          </div>
          <div className="border-t border-amber-100 pt-2 flex justify-between items-center">
            <div className="text-slate-400">إجمالي الأتعاب</div>
            <div className="font-mono font-bold text-slate-700">{formatYer(caseRecord.total_amount)}</div>
          </div>
          <div className="flex justify-between items-center">
            <div className="text-slate-400">المسدّد</div>
            <div className="font-mono font-bold text-emerald-700">{formatYer(caseRecord.paid_amount)}</div>
          </div>
          <div className="flex justify-between items-center bg-rose-50 rounded-lg px-2 py-1.5">
            <div className="text-rose-600 font-bold">المتبقي المستحق</div>
            <div className="font-mono font-black text-rose-700 text-sm">{formatYer(caseRecord.remaining_amount)}</div>
          </div>
        </div>

        {/* Message editor */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-500">نص الرسالة (عدّل حسب الحاجة)</label>
          <textarea
            value={customMessage || defaultMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            rows={7}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-right resize-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none leading-relaxed"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 justify-start">
          {whatsappEnabled && (
            <button
              type="button"
              disabled={sending || !hasPhone}
              onClick={() => void handleSend()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
            >
              <MessageCircle className="w-4 h-4" />
              {sending ? 'جاري الإرسال...' : 'إرسال واتساب'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
          >
            <Copy className="w-4 h-4" />
            نسخ الرسالة
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100">
            إغلاق
          </button>
        </div>

        {!hasPhone && (
          <p className="text-[11px] text-rose-600 bg-rose-50 rounded-xl px-3 py-2 font-bold">
            لا يوجد رقم هاتف للعميل — أضفه من صفحة العملاء لتتمكن من الإرسال.
          </p>
        )}
      </div>
    </div>
  );
}
