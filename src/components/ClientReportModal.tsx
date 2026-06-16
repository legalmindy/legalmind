import { useState } from 'react';
import type { Client, ClientReportChannel } from '../types/app';
import { buildClientReportMessage, logClientReport, openClientReportChannel } from '../lib/clientReports';

interface ClientReportModalProps {
  client: Client | null;
  open: boolean;
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  onClose: () => void;
  onSent?: (message: string) => void;
}

export function ClientReportModal({
  client,
  open,
  whatsappEnabled,
  smsEnabled,
  onClose,
  onSent
}: ClientReportModalProps) {
  const [channel, setChannel] = useState<ClientReportChannel>('whatsapp');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!open || !client) return null;

  const canWhatsApp = whatsappEnabled;
  const canSms = smsEnabled;
  const effectiveChannel = channel === 'whatsapp' && !canWhatsApp && canSms ? 'sms' : channel;
  const defaultMessage = buildClientReportMessage(client.name);

  const handleOpen = async () => {
    if (!client.phone?.trim()) {
      onSent?.('لا يوجد رقم هاتف مسجل لهذا العميل.');
      return;
    }
    const body = message.trim() || defaultMessage;
    setSending(true);
    try {
      openClientReportChannel(client.phone, effectiveChannel, body);
      await logClientReport({ clientId: client.id, channel: effectiveChannel, messageBody: body });
      onSent?.(`تم فتح ${effectiveChannel === 'whatsapp' ? 'واتساب' : 'SMS'} لإرسال التقرير.`);
      onClose();
    } catch (err) {
      onSent?.(err instanceof Error ? err.message : 'فشل تسجيل التقرير.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xl w-full max-w-lg p-6 space-y-4 text-right">
        <h3 className="text-lg font-black text-slate-900">إرسال تقرير للعميل</h3>
        <p className="text-xs text-slate-500">العميل: <strong className="text-slate-800">{client.name}</strong> — {client.phone || 'بدون هاتف'}</p>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canWhatsApp}
            onClick={() => setChannel('whatsapp')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold border ${channel === 'whatsapp' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'border-slate-200 text-slate-600'} disabled:opacity-40`}
          >
            WhatsApp
          </button>
          <button
            type="button"
            disabled={!canSms}
            onClick={() => setChannel('sms')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold border ${channel === 'sms' ? 'bg-indigo-50 border-indigo-300 text-indigo-800' : 'border-slate-200 text-slate-600'} disabled:opacity-40`}
          >
            SMS
          </button>
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={defaultMessage}
          rows={5}
          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs text-right resize-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
        />

        <div className="flex gap-2 justify-start">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">
            إلغاء
          </button>
          <button
            type="button"
            disabled={sending || (!canWhatsApp && !canSms)}
            onClick={() => void handleOpen()}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {sending ? 'جاري الإرسال...' : 'إرسال التقرير'}
          </button>
        </div>
      </div>
    </div>
  );
}
