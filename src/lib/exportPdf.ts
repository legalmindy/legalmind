import { EXPORT_ENTITY_LABELS, type ExportEntity } from './dataExport';

const COLUMN_LABELS: Record<string, string> = {
  id: 'المعرّف',
  name: 'الاسم',
  phone: 'الهاتف',
  email: 'البريد',
  type: 'النوع',
  address: 'العنوان',
  cases_count: 'عدد القضايا',
  created_at: 'تاريخ الإنشاء',
  title: 'العنوان',
  client_id: 'معرّف العميل',
  client_name: 'العميل',
  case_number: 'رقم القضية',
  court: 'المحكمة',
  stage: 'المرحلة',
  status: 'الحالة',
  total_fee: 'الأتعاب',
  paid_amount: 'المدفوع',
  remaining_amount: 'المتبقي',
  date_started: 'تاريخ البدء',
  case_id: 'معرّف القضية',
  case_title: 'القضية',
  session_date: 'تاريخ الجلسة',
  session_time: 'الوقت',
  session_type: 'نوع الجلسة',
  notes: 'ملاحظات',
  amount: 'المبلغ',
  payment_date: 'تاريخ الدفع',
  payment_method: 'طريقة الدفع',
  receipt_number: 'رقم السند',
  printed_at: 'تاريخ الطباعة',
  full_name: 'الاسم الكامل',
  role: 'الدور',
  firm_role: 'دور المكتب',
  category: 'التصنيف',
  expense_date: 'تاريخ المصروف',
  size: 'الحجم',
  uploaded_at: 'تاريخ الرفع'
};

const EXPORT_PDF_STYLES = `
  * { box-sizing: border-box; }
  .export-pdf-root {
    width: 100%;
    color: #0f172a;
    background: #ffffff;
    font-family: 'Cairo', Tahoma, Arial, sans-serif;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .export-pdf-header {
    text-align: center;
    border-bottom: 2px solid #7A1F2B;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .export-pdf-header h1 { margin: 0; font-size: 18px; }
  .export-pdf-header p { margin: 4px 0 0; }
  .export-pdf-section h2 {
    margin: 20px 0 8px;
    font-size: 14px;
    color: #7A1F2B;
    page-break-after: avoid;
  }
  .export-pdf-empty { color: #64748b; font-size: 12px; margin: 0 0 12px; }
  .export-pdf-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-bottom: 16px;
    table-layout: fixed;
    word-wrap: break-word;
  }
  .export-pdf-table th,
  .export-pdf-table td {
    border: 1px solid #cbd5e1;
    padding: 6px 8px;
    text-align: right;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .export-pdf-table th {
    background: #f1f5f9;
    font-weight: bold;
  }
  .export-pdf-table tr { page-break-inside: avoid; }
  .export-pdf-table thead { display: table-header-group; }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTableHtml(title: string, rows: Record<string, unknown>[]): string {
  if (!rows.length) {
    return `
      <section class="export-pdf-section">
        <h2>${escapeHtml(title)}</h2>
        <p class="export-pdf-empty">لا توجد سجلات.</p>
      </section>`;
  }

  const headers = Object.keys(rows[0]!);
  const head = headers.map((h) => `<th>${escapeHtml(COLUMN_LABELS[h] ?? h)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = headers.map((h) => `<td>${escapeHtml(row[h] == null ? '' : String(row[h]))}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `
    <section class="export-pdf-section">
      <h2>${escapeHtml(title)}</h2>
      <table class="export-pdf-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

export function buildExportPdfHtml(
  sections: Array<{ entity: ExportEntity; rows: Record<string, unknown>[] }>,
  meta?: { firmName?: string; dateFrom?: string; dateTo?: string }
): string {
  const stamp = new Date().toLocaleString('ar-YE');
  const filters =
    meta?.dateFrom || meta?.dateTo
      ? `<p style="font-size:11px;color:#64748b">الفترة: ${meta.dateFrom ?? '—'} إلى ${meta.dateTo ?? '—'}</p>`
      : '';

  const tables = sections
    .map(({ entity, rows }) => buildTableHtml(EXPORT_ENTITY_LABELS[entity], rows))
    .join('');

  return `
    <style>${EXPORT_PDF_STYLES}</style>
    <div class="export-pdf-root" dir="rtl">
      <div class="export-pdf-header">
        <h1>تصدير بيانات المكتب</h1>
        ${meta?.firmName ? `<p style="font-size:12px;color:#475569">${escapeHtml(meta.firmName)}</p>` : ''}
        <p style="font-size:10px;color:#94a3b8">${stamp}</p>
        ${filters}
      </div>
      ${tables || '<p class="export-pdf-empty">لا توجد بيانات للتصدير.</p>'}
    </div>`;
}

async function waitForLayout(target?: Document): Promise<void> {
  await document.fonts.ready;
  if (target?.fonts?.ready) {
    await target.fonts.ready;
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function mountCaptureHost(html: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'pdf-export');
  // Keep in viewport for html2canvas — off-screen positioning produces blank PDFs.
  iframe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:794px',
    'height:1123px',
    'border:0',
    'margin:0',
    'padding:0',
    'z-index:-1',
    'pointer-events:none',
    'overflow:hidden'
  ].join(';');

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    throw new Error('تعذر تهيئة عارض التصدير');
  }

  doc.open();
  doc.write(
    `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /></head><body style="margin:0;padding:16px;background:#fff">${html}</body></html>`
  );
  doc.close();

  return iframe;
}

export async function downloadHtmlAsPdf(filename: string, html: string): Promise<void> {
  const iframe = mountCaptureHost(html);
  const doc = iframe.contentDocument;
  const body = doc?.body;

  if (!doc || !body) {
    iframe.remove();
    throw new Error('تعذر تحميل محتوى التصدير');
  }

  const pdfOptions = {
    margin: [10, 10, 10, 10] as [number, number, number, number],
    filename,
    image: { type: 'jpeg' as const, quality: 0.95 },
    jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
    pagebreak: { mode: ['css', 'legacy'] as const }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        void waitForLayout(doc).then(resolve).catch(reject);
      };
      if (doc.readyState === 'complete') {
        finish();
        return;
      }
      iframe.onload = finish;
      iframe.onerror = () => reject(new Error('تعذر تحميل محتوى التصدير'));
    });

    const contentHeight = Math.max(body.scrollHeight, body.offsetHeight, 1123);
    iframe.style.height = `${contentHeight}px`;

    await waitForLayout(doc);

    const html2canvasOptions = {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      width: 794,
      height: contentHeight,
      windowWidth: 794,
      windowHeight: contentHeight,
      onclone: (clonedDoc: Document) => {
        const clonedBody = clonedDoc.body;
        clonedBody.style.opacity = '1';
        clonedBody.style.visibility = 'visible';
        clonedBody.style.background = '#ffffff';
        clonedBody.style.margin = '0';
        clonedBody.style.padding = '16px';
      }
    };

    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf()
      .set({ ...pdfOptions, html2canvas: html2canvasOptions })
      .from(body)
      .save();
  } finally {
    iframe.remove();
  }
}
