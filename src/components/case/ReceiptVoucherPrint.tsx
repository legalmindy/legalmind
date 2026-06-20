import { AppLogo } from '../AppLogo';
import type { ReceiptVoucher } from '../../types/app';

interface ReceiptVoucherPrintProps {
  voucher: ReceiptVoucher;
  firmName: string;
  onPrint: () => void;
  onDownload?: () => void;
}

function qrImageUrl(payload: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(payload)}`;
}

export function ReceiptVoucherPrint({ voucher, firmName, onPrint, onDownload }: ReceiptVoucherPrintProps) {
  const printedDate = new Date(voucher.printedAt).toLocaleDateString('ar-YE');

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:shadow-none" dir="rtl">
      <div id="receipt-voucher-print" className="space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <AppLogo variant="law" size="sm" />
            <div>
              <h2 className="text-lg font-black text-slate-900">{firmName}</h2>
              <p className="text-xs text-slate-500">سند قبض رسمي</p>
            </div>
          </div>
          {voucher.qrPayload ? (
            <img
              src={qrImageUrl(voucher.qrPayload)}
              alt="QR"
              className="h-24 w-24 rounded-lg border border-slate-100"
            />
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">رقم السند:</span> <strong>{voucher.receiptNumber}</strong></div>
          <div><span className="text-slate-500">التاريخ:</span> <strong>{printedDate}</strong></div>
          <div><span className="text-slate-500">رقم القضية:</span> <strong>{voucher.caseNumber ?? '—'}</strong></div>
          <div><span className="text-slate-500">الموكل:</span> <strong>{voucher.clientName ?? '—'}</strong></div>
          <div><span className="text-slate-500">المبلغ المستلم:</span> <strong className="text-emerald-700">{voucher.amount.toLocaleString()} ر.ي</strong></div>
          <div><span className="text-slate-500">طريقة الدفع:</span> <strong>{voucher.paymentMethod ?? '—'}</strong></div>
          <div><span className="text-slate-500">إجمالي العقد:</span> <strong>{(voucher.contractTotal ?? 0).toLocaleString()} ر.ي</strong></div>
          <div><span className="text-slate-500">المتبقي:</span> <strong>{(voucher.remainingBalance ?? 0).toLocaleString()} ر.ي</strong></div>
        </div>

        {voucher.notes ? (
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <span className="font-bold">ملاحظات: </span>{voucher.notes}
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-2 gap-8 border-t border-dashed border-slate-300 pt-6 text-center text-xs text-slate-500">
          <div>
            <div className="mb-8 border-b border-slate-300" />
            توقيع المستلم
          </div>
          <div>
            <div className="mb-8 border-b border-slate-300" />
            توقيع معتمد المكتب
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={onPrint}
          className="rounded-xl bg-[#7A1F2B] px-4 py-2 text-xs font-bold text-white hover:bg-[#641923]"
        >
          طباعة السند
        </button>
        {onDownload ? (
          <button
            type="button"
            onClick={onDownload}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            تحميل PDF
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function printReceiptElement(): void {
  const el = document.getElementById('receipt-voucher-print');
  if (!el) return;
  const html = el.outerHTML;
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>سند قبض</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111} img{float:left}</style></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
