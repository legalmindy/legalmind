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

/** Opens a print-friendly window and triggers the system print dialog. */
export function printHtml(title: string, html: string): void {
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) {
    throw new Error('تعذر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.');
  }

  const safeTitle = escapeHtml(title);
  win.document.open();
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${safeTitle}</title>
    <style>
      body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111;line-height:1.5}
      .header{text-align:center;border-bottom:2px solid #7A1F2B;padding-bottom:16px;margin-bottom:20px}
      .header h1{margin:0;font-size:1.35rem}
      h2{font-size:1rem;margin:24px 0 8px;color:#334155}
      table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
      th,td{border:1px solid #cbd5e1;padding:8px;text-align:right}
      th{background:#f1f5f9;font-weight:bold}
      .print-actions{margin-top:28px;text-align:center}
      .print-btn{background:#7A1F2B;color:#fff;border:none;padding:10px 28px;border-radius:8px;font:bold 14px Tahoma;cursor:pointer}
      @media print{
        .print-actions{display:none}
        body{padding:10mm}
        @page{margin:12mm}
      }
    </style></head><body>
      ${html}
      <div class="print-actions">
        <button type="button" class="print-btn" onclick="window.print()">طباعة</button>
      </div>
      <script>
        window.onload=function(){window.focus();setTimeout(function(){window.print();},300);};
        window.onafterprint=function(){window.close();};
      </script>
    </body></html>`);
  win.document.close();
}
