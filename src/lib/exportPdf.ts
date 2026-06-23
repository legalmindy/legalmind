import html2pdf from 'html2pdf.js';
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTableHtml(title: string, rows: Record<string, unknown>[]): string {
  if (!rows.length) {
    return `<h2>${escapeHtml(title)}</h2><p style="color:#64748b;font-size:12px">لا توجد سجلات.</p>`;
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
    <h2 style="margin:20px 0 8px;font-size:14px;color:#7A1F2B">${escapeHtml(title)}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px">
      <thead><tr style="background:#f1f5f9">${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
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
    <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;color:#0f172a;padding:8px">
      <div style="text-align:center;border-bottom:2px solid #7A1F2B;padding-bottom:12px;margin-bottom:16px">
        <h1 style="margin:0;font-size:18px">تصدير بيانات المكتب</h1>
        ${meta?.firmName ? `<p style="margin:4px 0 0;font-size:12px;color:#475569">${escapeHtml(meta.firmName)}</p>` : ''}
        <p style="margin:4px 0 0;font-size:10px;color:#94a3b8">${stamp}</p>
        ${filters}
      </div>
      ${tables}
    </div>`;
}

export async function downloadHtmlAsPdf(filename: string, html: string): Promise<void> {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '0';
  wrapper.style.width = '794px';
  document.body.appendChild(wrapper);

  try {
    await html2pdf()
      .set({
        margin: [12, 12, 12, 12],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      })
      .from(wrapper)
      .save();
  } finally {
    document.body.removeChild(wrapper);
  }
}
