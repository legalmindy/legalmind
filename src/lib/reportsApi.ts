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

export function printHtml(title: string, html: string): void {
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}
      .header{text-align:center;border-bottom:2px solid #7A1F2B;padding-bottom:16px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #ddd;padding:8px;text-align:right}
      th{background:#f8fafc}
      @media print{button{display:none}}
    </style></head><body>${html}<button onclick="window.print()">طباعة</button></body></html>`);
  win.document.close();
}
