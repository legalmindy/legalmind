import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  fetchAllCases,
  fetchAllClients,
  fetchDocuments,
  fetchEmployees,
  fetchExpenses,
  fetchOffice,
  fetchSessions,
  getCurrentFirmId,
  getDocumentDownloadUrl
} from './api';
import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import { exportToCsv } from './reportsApi';
import { registerFirmExport } from './securityApi';
import { decryptFileBlob } from './fileEncryption';
import { buildExportPdfHtml, downloadHtmlAsPdf } from './exportPdf';

export type ExportEntity =
  | 'clients'
  | 'cases'
  | 'sessions'
  | 'payments'
  | 'receipts'
  | 'expenses'
  | 'employees'
  | 'documents';

export type ExportFormat = 'xlsx' | 'csv' | 'zip' | 'pdf';

export interface ExportFilters {
  dateFrom?: string;
  dateTo?: string;
  caseId?: string;
  clientId?: string;
}

export const EXPORT_ENTITY_LABELS: Record<ExportEntity, string> = {
  clients: 'العملاء',
  cases: 'القضايا',
  sessions: 'الجلسات',
  payments: 'المدفوعات',
  receipts: 'سندات القبض',
  expenses: 'المصروفات',
  employees: 'المستخدمين',
  documents: 'الملفات والمرفقات'
};

function inDateRange(value: string | undefined, filters: ExportFilters): boolean {
  if (!value) return true;
  const day = value.slice(0, 10);
  if (filters.dateFrom && day < filters.dateFrom) return false;
  if (filters.dateTo && day > filters.dateTo) return false;
  return true;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function rowsToSheet(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(rows);
}

const filtersPayload = (filters: ExportFilters): Record<string, unknown> => ({ ...filters });

async function fetchPayments(filters: ExportFilters): Promise<Record<string, unknown>[]> {
  const firmId = await getCurrentFirmId();
  let query = supabase
    .from('case_payments')
    .select('id, case_id, amount, payment_date, payment_method, notes, created_at, cases(title, client_id)')
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .order('payment_date', { ascending: false });

  if (filters.caseId) query = query.eq('case_id', filters.caseId);

  const { data, error } = await query;
  throwIfSupabaseError(error);

  return (data ?? [])
    .filter((row) => inDateRange(String(row.payment_date ?? row.created_at), filters))
    .map((row) => ({
      id: row.id,
      case_id: row.case_id,
      case_title: (row.cases as { title?: string } | null)?.title ?? '',
      amount: row.amount,
      payment_date: row.payment_date,
      payment_method: row.payment_method,
      notes: row.notes ?? ''
    }));
}

async function fetchReceipts(filters: ExportFilters): Promise<Record<string, unknown>[]> {
  const firmId = await getCurrentFirmId();
  let query = supabase
    .from('receipt_vouchers')
    .select(
      'id, case_id, receipt_number, amount, client_name, case_number, payment_method, notes, printed_at, created_at, cases(title)'
    )
    .eq('firm_id', firmId)
    .order('printed_at', { ascending: false });

  if (filters.caseId) query = query.eq('case_id', filters.caseId);

  const { data, error } = await query;
  throwIfSupabaseError(error);

  return (data ?? [])
    .filter((row) => inDateRange(String(row.printed_at ?? row.created_at), filters))
    .map((row) => ({
      id: row.id,
      case_id: row.case_id,
      case_title: (row.cases as { title?: string } | null)?.title ?? '',
      receipt_number: row.receipt_number,
      amount: row.amount,
      printed_at: row.printed_at,
      client_name: row.client_name ?? '',
      case_number: row.case_number ?? '',
      payment_method: row.payment_method ?? '',
      notes: row.notes ?? ''
    }));
}

export async function collectEntityRows(
  entity: ExportEntity,
  filters: ExportFilters
): Promise<Record<string, unknown>[]> {
  switch (entity) {
    case 'clients': {
      const rows = await fetchAllClients();
      return rows
        .filter((c) => !filters.clientId || c.id === filters.clientId)
        .filter((c) => inDateRange(c.createdAt, filters))
        .map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email ?? '',
          type: c.type,
          address: c.address ?? '',
          cases_count: c.casesCount,
          created_at: c.createdAt
        }));
    }
    case 'cases': {
      const rows = await fetchAllCases();
      return rows
        .filter((c) => !filters.caseId || c.id === filters.caseId)
        .filter((c) => !filters.clientId || c.clientId === filters.clientId)
        .filter((c) => inDateRange(c.dateStarted, filters))
        .map((c) => ({
          id: c.id,
          title: c.title,
          client_id: c.clientId,
          client_name: c.clientName,
          case_number: c.court_case_number || c.caseNo,
          court: c.court,
          type: c.case_type,
          stage: c.case_stage,
          status: c.status,
          total_fee: c.total_amount,
          paid_amount: c.paid_amount,
          remaining_amount: c.remaining_amount,
          date_started: c.dateStarted
        }));
    }
    case 'sessions': {
      const rows = await fetchSessions();
      return rows
        .filter((s) => !filters.caseId || s.caseId === filters.caseId)
        .filter((s) => inDateRange(s.date, filters))
        .map((s) => ({
          id: s.id,
          case_id: s.caseId,
          case_title: s.caseTitle,
          court: s.court,
          session_date: s.date,
          session_time: s.time,
          status: s.status,
          session_type: s.type ?? '',
          notes: s.notes ?? ''
        }));
    }
    case 'payments':
      return fetchPayments(filters);
    case 'receipts':
      return fetchReceipts(filters);
    case 'expenses': {
      const rows = await fetchExpenses();
      return rows
        .filter((e) => inDateRange(e.expense_date, filters))
        .map((e) => ({
          id: e.id,
          title: e.title,
          amount: e.amount,
          category: e.category,
          expense_date: e.expense_date,
          notes: e.notes ?? ''
        }));
    }
    case 'employees': {
      const rows = await fetchEmployees();
      return rows.map((e) => ({
        id: e.id,
        full_name: e.full_name,
        email: e.email,
        phone: e.phone,
        role: e.role,
        firm_role: e.firmRoleName ?? '',
        status: e.status,
        created_at: e.created_at
      }));
    }
    case 'documents': {
      const docs = await fetchDocuments();
      return docs
        .filter((d) => !filters.caseId || d.caseId === filters.caseId)
        .filter((d) => inDateRange(d.dateUploaded, filters))
        .map((d) => ({
          id: d.id,
          title: d.title,
          case_id: d.caseId,
          case_title: d.caseTitle,
          category: d.category,
          size: d.size,
          uploaded_at: d.dateUploaded
        }));
    }
    default:
      return [];
  }
}

export async function downloadDocumentsZip(filters: ExportFilters): Promise<{ blob: Blob; count: number }> {
  const firmId = await getCurrentFirmId();
  const docs = await fetchDocuments();
  const filtered = docs.filter((d) => {
    if (filters.caseId && d.caseId !== filters.caseId) return false;
    return inDateRange(d.dateUploaded, filters);
  });

  const zip = new JSZip();
  const manifest: Record<string, unknown>[] = [];

  for (const doc of filtered) {
    try {
      const { data: meta } = await supabase
        .from('documents')
        .select('storage_path, is_encrypted, file_type')
        .eq('id', doc.id)
        .maybeSingle();

      const url = await getDocumentDownloadUrl(doc.id);
      const response = await fetch(url);
      if (!response.ok) continue;

      let blob = await response.blob();
      if (meta?.is_encrypted) {
        blob = await decryptFileBlob(blob);
      }

      const folder = doc.caseTitle.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'عام';
      const filename = doc.title.replace(/[/\\?%*:|"<>]/g, '-').trim() || doc.id;
      zip.file(`documents/${folder}/${filename}`, blob);
      manifest.push({
        id: doc.id,
        title: doc.title,
        case_id: doc.caseId,
        encrypted: Boolean(meta?.is_encrypted)
      });
    } catch {
      manifest.push({ id: doc.id, title: doc.title, error: 'تعذر التحميل' });
    }
  }

  zip.file('documents/manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('meta/firm_id.txt', firmId);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, count: filtered.length };
}

export async function downloadCaseAttachmentsZip(): Promise<{ blob: Blob; count: number }> {
  const firmId = await getCurrentFirmId();
  const { data: cases, error: casesError } = await supabase
    .from('cases')
    .select('id, title')
    .eq('firm_id', firmId)
    .is('deleted_at', null);
  throwIfSupabaseError(casesError);
  const caseIds = (cases ?? []).map((c) => c.id as string);
  const caseTitles = new Map((cases ?? []).map((c) => [c.id as string, c.title as string]));

  if (!caseIds.length) {
    const empty = new JSZip();
    empty.file('attachments/manifest.json', '[]');
    return { blob: await empty.generateAsync({ type: 'blob' }), count: 0 };
  }

  const { data: attachments, error } = await supabase
    .from('case_attachments')
    .select('id, case_id, file_name, file_type, file_size, storage_path, version, notes')
    .in('case_id', caseIds)
    .is('deleted_at', null);
  throwIfSupabaseError(error);

  const zip = new JSZip();
  const manifest: Record<string, unknown>[] = [];
  let count = 0;

  for (const row of attachments ?? []) {
    try {
      const { data: signed, error: signError } = await supabase.storage
        .from('case-documents')
        .createSignedUrl(row.storage_path as string, 300);
      if (signError || !signed?.signedUrl) continue;

      const response = await fetch(signed.signedUrl);
      if (!response.ok) continue;

      const blob = await response.blob();
      const caseTitle = (caseTitles.get(row.case_id as string) ?? 'عام').replace(/[/\\?%*:|"<>]/g, '-').trim();
      const fileName = (row.file_name as string).replace(/[/\\?%*:|"<>]/g, '-').trim() || row.id;
      zip.file(`attachments/${caseTitle}/${fileName}`, blob);
      manifest.push({
        id: row.id,
        case_id: row.case_id,
        file_name: row.file_name,
        file_type: row.file_type,
        file_size: row.file_size,
        storage_path: row.storage_path,
        version: row.version,
        notes: row.notes
      });
      count += 1;
    } catch {
      manifest.push({ id: row.id, file_name: row.file_name, error: 'تعذر التحميل' });
    }
  }

  zip.file('attachments/manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('meta/firm_id.txt', firmId);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, count };
}

export async function exportFirmData(
  entities: ExportEntity[],
  format: ExportFormat,
  filters: ExportFilters = {}
): Promise<{ recordCount: number; filename: string }> {
  const stamp = new Date().toISOString().slice(0, 10);
  let recordCount = 0;

  if (format === 'zip' && entities.includes('documents')) {
    const { blob, count } = await downloadDocumentsZip(filters);
    const filename = `legalmind-documents-${stamp}.zip`;
    triggerDownload(blob, filename);
    await registerFirmExport('documents', 'zip', filtersPayload(filters), count);
    return { recordCount: count, filename };
  }

  const sheets: Record<string, Record<string, unknown>[]> = {};
  for (const entity of entities) {
    if (entity === 'documents') continue;
    const rows = await collectEntityRows(entity, filters);
    sheets[entity] = rows;
    if (format !== 'pdf') {
      recordCount += rows.length;
    }
  }

  if (format === 'pdf') {
    const exportable = entities.filter((entity) => entity !== 'documents');
    if (!exportable.length) {
      throw new Error('اختر نوع بيانات غير الملفات للتصدير بصيغة PDF.');
    }

    const office = await fetchOffice();
    const sections: Array<{ entity: ExportEntity; rows: Record<string, unknown>[] }> = [];
    for (const entity of exportable) {
      const rows = sheets[entity] ?? (await collectEntityRows(entity, filters));
      sections.push({ entity, rows });
      recordCount += rows.length;
    }
    const html = buildExportPdfHtml(sections, {
      firmName: office.name,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo
    });
    const filename = `legalmind-export-${stamp}.pdf`;
    await downloadHtmlAsPdf(filename, html);
    await registerFirmExport(entities.join(','), 'pdf', filtersPayload(filters), recordCount);
    return { recordCount, filename };
  }

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    for (const entity of entities) {
      if (entity === 'documents') continue;
      const rows = sheets[entity] ?? [];
      if (rows.length) {
        XLSX.utils.book_append_sheet(wb, rowsToSheet(rows), EXPORT_ENTITY_LABELS[entity].slice(0, 31));
      }
    }
    const filename = `legalmind-export-${stamp}.xlsx`;
    XLSX.writeFile(wb, filename);
    await registerFirmExport(entities.join(','), 'xlsx', filtersPayload(filters), recordCount);
    return { recordCount, filename };
  }

  if (entities.length === 1 && entities[0] !== 'documents') {
    const entity = entities[0]!;
    const rows = await collectEntityRows(entity, filters);
    const filename = `legalmind-${entity}-${stamp}.csv`;
    exportToCsv(filename, rows);
    await registerFirmExport(entity, 'csv', filtersPayload(filters), rows.length);
    return { recordCount: rows.length, filename };
  }

  const zip = new JSZip();
  for (const entity of entities) {
    if (entity === 'documents') continue;
    const rows = await collectEntityRows(entity, filters);
    if (!rows.length) continue;
    const sheet = rowsToSheet(rows);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    zip.file(`${entity}.csv`, '\uFEFF' + csv);
  }

  if (entities.includes('documents')) {
    const { blob, count } = await downloadDocumentsZip(filters);
    const inner = await JSZip.loadAsync(blob);
    for (const [path, file] of Object.entries(inner.files)) {
      if (!file.dir) zip.file(path, await file.async('blob'));
    }
    recordCount += count;
  }

  const filename = `legalmind-export-${stamp}.zip`;
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, filename);
  await registerFirmExport(entities.join(','), 'zip', filtersPayload(filters), recordCount);
  return { recordCount, filename };
}

export async function exportAllFirmData(format: ExportFormat, filters: ExportFilters = {}) {
  const entities: ExportEntity[] = [
    'clients',
    'cases',
    'sessions',
    'payments',
    'receipts',
    'expenses',
    'employees',
    'documents'
  ];
  return exportFirmData(entities, format === 'csv' ? 'zip' : format, filters);
}