import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

export async function fetchFinancialReport(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('get_financial_report');
  throwIfSupabaseError(error);
  return (data as Record<string, unknown>) ?? {};
}

export async function fetchOutstandingBalances(): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc('get_outstanding_balances_report');
  throwIfSupabaseError(error);
  return (data as Record<string, unknown>[]) ?? [];
}

export async function fetchPaymentsReport(from?: string, to?: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc('get_payments_report', {
    p_from: from ?? null,
    p_to: to ?? null
  });
  throwIfSupabaseError(error);
  return (data as Record<string, unknown>[]) ?? [];
}

export async function fetchSessionReport(from?: string, to?: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc('get_session_report', {
    p_from: from ?? null,
    p_to: to ?? null
  });
  throwIfSupabaseError(error);
  return (data as Record<string, unknown>[]) ?? [];
}

export interface AuditLogRow {
  id: string;
  tableName: string;
  recordId: string;
  operation: string;
  actionType?: string;
  changedBy?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

export interface FirmActivityLogRow extends AuditLogRow {
  entitySummary?: string;
  employeeName?: string;
  employeeId?: string;
}

export async function fetchAuditLogs(limit = 100): Promise<AuditLogRow[]> {
  const { data, error } = await supabase.rpc('list_firm_audit_logs', { p_limit: limit });
  throwIfSupabaseError(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    tableName: String(row.table_name),
    recordId: String(row.record_id),
    operation: String(row.operation),
    actionType: (row.action_type as string) ?? undefined,
    changedBy: (row.changed_by as string) ?? undefined,
    changes: (row.changes as Record<string, unknown>) ?? undefined,
    ipAddress: (row.ip_address as string) ?? undefined,
    createdAt: String(row.created_at)
  }));
}

export async function fetchFirmActivityLogs(
  limit = 200,
  tableFilter?: string,
  dateFrom?: string,
  dateTo?: string,
  search?: string
): Promise<FirmActivityLogRow[]> {
  const { data, error } = await supabase.rpc('list_firm_activity_logs', {
    p_limit: limit,
    p_table_filter: tableFilter?.trim() || null,
    p_from: dateFrom ? new Date(dateFrom).toISOString() : null,
    p_to: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : null,
    p_search: search?.trim() || null
  });
  throwIfSupabaseError(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    tableName: String(row.table_name),
    recordId: String(row.record_id ?? row.id),
    operation: String(row.operation),
    actionType: (row.action_type as string) ?? undefined,
    entitySummary: (row.entity_summary as string) ?? undefined,
    employeeName: (row.employee_name as string) ?? undefined,
    employeeId: (row.employee_id as string) ?? undefined,
    changedBy: (row.employee_id as string) ?? undefined,
    changes: (row.changes as Record<string, unknown>) ?? undefined,
    ipAddress: (row.ip_address as string) ?? undefined,
    createdAt: String(row.created_at)
  }));
}

export function exportToCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]!);
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const text = val == null ? '' : String(val).replace(/"/g, '""');
          return `"${text}"`;
        })
        .join(',')
    )
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrintDocument(title: string, html: string): string {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${safeTitle}</title>
    <style>
      body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .header{text-align:center;border-bottom:2px solid #7A1F2B;padding-bottom:16px;margin-bottom:20px}
      .header h1{margin:0;font-size:1.35rem}
      h2{font-size:1rem;margin:24px 0 8px;color:#334155;page-break-after:avoid}
      table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;page-break-inside:avoid}
      th,td{border:1px solid #333;padding:8px;text-align:right}
      th{background:#eee;font-weight:bold}
      tr{page-break-inside:avoid}
      @page{size:A4;margin:15mm}
      @media print{
        body{padding:0}
        .no-print{display:none!important}
      }
    </style></head><body>
      ${html}
    </body></html>`;
}

/** Opens the system print dialog so the user can send the report to a printer. */
export function printHtml(title: string, html: string): void {
  const documentHtml = buildPrintDocument(title, html);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDoc = iframe.contentDocument ?? frameWindow?.document;
  if (!frameWindow || !frameDoc) {
    document.body.removeChild(iframe);
    printHtmlViaPopup(title, documentHtml);
    return;
  }

  frameDoc.open();
  frameDoc.write(documentHtml);
  frameDoc.close();

  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };

  const triggerPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
      printHtmlViaPopup(title, documentHtml);
      return;
    }
    window.setTimeout(cleanup, 1500);
  };

  if (frameDoc.readyState === 'complete') {
    window.setTimeout(triggerPrint, 300);
  } else {
    iframe.onload = () => window.setTimeout(triggerPrint, 300);
  }
}

function printHtmlViaPopup(_title: string, documentHtml: string): void {
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) {
    throw new Error('تعذر فتح الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.');
  }

  win.document.open();
  win.document.write(
    documentHtml.replace(
      '</body>',
      `<div class="no-print" style="margin-top:28px;text-align:center">
        <button type="button" onclick="window.print()" style="background:#7A1F2B;color:#fff;border:none;padding:10px 28px;border-radius:8px;font:bold 14px Tahoma;cursor:pointer">
          طباعة
        </button>
      </div></body>`
    )
  );
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 400);
}
