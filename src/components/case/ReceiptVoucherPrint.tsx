import { AppLogo } from '../AppLogo';
import { escapeHtml } from '../../lib/sanitize';
import type { ReceiptVoucher } from '../../types/app';

const BRAND = '#7A1F2B';

interface ReceiptVoucherPrintProps {
  voucher: ReceiptVoucher;
  firmName: string;
  onPrint: () => void;
  onDownload?: () => void;
}

function formatAmount(n: number): string {
  return `${n.toLocaleString('ar-YE')} ر.ي`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar-YE', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
}

/** Screen preview of the official receipt (no QR — matches print). */
export function ReceiptVoucherPrint({ voucher, firmName, onPrint, onDownload }: ReceiptVoucherPrintProps) {
  const printedDate = formatDate(voucher.printedAt);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:shadow-none" dir="rtl">
      <div id="receipt-voucher-print" className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 pb-4" style={{ borderColor: BRAND }}>
          <AppLogo variant="law" size="sm" />
          <div>
            <h2 className="text-lg font-black" style={{ color: BRAND }}>
              {firmName}
            </h2>
            <p className="text-xs font-bold text-slate-500">سند قبض رسمي</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          <Field label="رقم السند" value={voucher.receiptNumber} mono accent />
          <Field label="التاريخ" value={printedDate} />
          <Field label="رقم القضية" value={voucher.caseNumber ?? '—'} mono />
          <Field label="الموكل" value={voucher.clientName ?? '—'} />
          <Field label="المبلغ المستلم" value={formatAmount(voucher.amount)} accent strong />
          <Field label="طريقة الدفع" value={voucher.paymentMethod ?? '—'} />
          <Field label="إجمالي العقد" value={formatAmount(voucher.contractTotal ?? 0)} />
          <Field label="المتبقي" value={formatAmount(voucher.remainingBalance ?? 0)} />
        </div>

        {voucher.notes ? (
          <p className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
            <span className="font-bold" style={{ color: BRAND }}>
              ملاحظات:{' '}
            </span>
            {voucher.notes}
          </p>
        ) : null}

        <div className="mt-10 grid grid-cols-2 gap-10 border-t border-dashed border-slate-300 pt-8 text-center text-xs text-slate-500">
          <div>
            <div className="mb-10 border-b border-slate-400" />
            توقيع المستلم
          </div>
          <div>
            <div className="mb-10 border-b border-slate-400" />
            توقيع معتمد المكتب
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={onPrint}
          className="rounded-xl px-4 py-2 text-xs font-bold text-white hover:opacity-95"
          style={{ backgroundColor: BRAND }}
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

function Field({
  label,
  value,
  mono,
  accent,
  strong
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-[#FFF9FA] px-3 py-2.5">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      <strong
        className={`block text-sm ${mono ? 'font-mono' : ''} ${strong ? 'text-base' : ''}`}
        style={{ color: accent ? BRAND : '#0f172a' }}
      >
        {value}
      </strong>
    </div>
  );
}

/** Build a self-contained print document (no QR, brand colors). */
export function buildReceiptPrintHtml(voucher: ReceiptVoucher, firmName: string): string {
  const printedDate = formatDate(voucher.printedAt);
  const notesBlock = voucher.notes
    ? `<div class="notes"><span>ملاحظات:</span> ${escapeHtml(voucher.notes)}</div>`
    : '';

  const rows: Array<[string, string, boolean?]> = [
    ['رقم السند', voucher.receiptNumber, true],
    ['التاريخ', printedDate],
    ['رقم القضية', voucher.caseNumber ?? '—'],
    ['الموكل', voucher.clientName ?? '—'],
    ['المبلغ المستلم', formatAmount(voucher.amount), true],
    ['طريقة الدفع', voucher.paymentMethod ?? '—'],
    ['إجمالي العقد', formatAmount(voucher.contractTotal ?? 0)],
    ['المتبقي', formatAmount(voucher.remainingBalance ?? 0)]
  ];

  const fieldsHtml = rows
    .map(
      ([label, value, accent]) =>
        `<div class="field${accent ? ' accent' : ''}">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </div>`
    )
    .join('');

  return `
    <div class="receipt">
      <header>
        <div class="logo" aria-hidden="true">⚖</div>
        <div>
          <h1>${escapeHtml(firmName)}</h1>
          <p>سند قبض رسمي</p>
        </div>
      </header>
      <div class="grid">${fieldsHtml}</div>
      ${notesBlock}
      <footer>
        <div class="sign"><div class="line"></div>توقيع المستلم</div>
        <div class="sign"><div class="line"></div>توقيع معتمد المكتب</div>
      </footer>
    </div>
  `;
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px;
    font-family: Tahoma, "Segoe UI", Arial, sans-serif;
    color: #0f172a;
    background: #fff;
    direction: rtl;
  }
  .receipt { max-width: 720px; margin: 0 auto; }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    border-bottom: 3px solid ${BRAND};
    padding-bottom: 16px;
    margin-bottom: 22px;
  }
  .logo {
    width: 44px; height: 44px;
    border-radius: 10px;
    background: ${BRAND};
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    color: ${BRAND};
    font-weight: 900;
  }
  header p {
    margin: 4px 0 0;
    font-size: 13px;
    color: #64748b;
    font-weight: 700;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .field {
    border: 1px solid #e2e8f0;
    background: #fff9fa;
    border-radius: 12px;
    padding: 12px 14px;
  }
  .field .label {
    font-size: 11px;
    color: #64748b;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .field .value {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
  }
  .field.accent .value { color: ${BRAND}; font-size: 16px; }
  .notes {
    margin-top: 16px;
    padding: 12px 14px;
    border-radius: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    font-size: 13px;
    color: #475569;
  }
  .notes span { color: ${BRAND}; font-weight: 800; }
  footer {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px dashed #cbd5e1;
    text-align: center;
    font-size: 12px;
    color: #64748b;
  }
  .sign .line {
    border-bottom: 1px solid #94a3b8;
    margin-bottom: 36px;
    height: 40px;
  }
  @media print {
    body { padding: 12mm; }
    .field { break-inside: avoid; }
  }
`;

/** Open a clean print window for any voucher (no QR). */
export function printReceiptVoucher(voucher: ReceiptVoucher, firmName: string): void {
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) {
    throw new Error('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
  }
  const title = `سند قبض ${voucher.receiptNumber}`;
  win.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  ${buildReceiptPrintHtml(voucher, firmName)}
</body>
</html>`);
  win.document.close();
  win.focus();
  window.setTimeout(() => {
    win.print();
  }, 150);
}

/** Fallback for callers that still print from the on-screen preview DOM. */
export function printReceiptElement(): void {
  const el = document.getElementById('receipt-voucher-print');
  if (!el) return;
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>سند قبض</title>
    <style>
      body{font-family:Tahoma,Arial,sans-serif;padding:28px;color:#0f172a;direction:rtl}
      strong{color:${BRAND}}
    </style></head><body>${el.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
